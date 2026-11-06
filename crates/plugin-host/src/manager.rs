use crate::{Activation, Error, InstanceKey, PluginHost, Result};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

struct Generation {
    key: InstanceKey,
    plugin_id: String,
    host: Arc<PluginHost>,
}

impl Drop for Generation {
    fn drop(&mut self) {
        // The active route and every Session lease own this generation. Cleanup starts
        // only after its final owner is gone, rather than after an arbitrary timeout.
        let host = self.host.clone();
        let key = self.key.clone();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Err(error) = host.deactivate(&key).await {
                    eprintln!("plugin generation cleanup failed ({key:?}): {error}");
                }
            });
        }
    }
}

/// Retains the exact generation selected by a Session. Clone shares the lease.
#[derive(Clone)]
pub struct PluginLease {
    generation: Arc<Generation>,
}

impl PluginLease {
    pub fn key(&self) -> &InstanceKey {
        &self.generation.key
    }

    pub async fn invoke(
        &self,
        handler: &str,
        input: Value,
        workspace: Option<&str>,
        timeout: Duration,
    ) -> Result<Value> {
        self.generation
            .host
            .invoke(&self.generation.key, handler, input, workspace, timeout)
            .await
    }
}

#[derive(Default)]
struct Routes {
    active: HashMap<String, Arc<Generation>>,
    highest_generation: HashMap<String, u64>,
}

/// In-memory P0 routing. Installation, persistent catalog and dependency ordering come later.
pub struct PluginManager {
    host: Arc<PluginHost>,
    routes: Mutex<Routes>,
    update_gate: tokio::sync::Mutex<()>,
}

impl PluginManager {
    pub fn new(host: Arc<PluginHost>) -> Self {
        Self {
            host,
            routes: Mutex::new(Routes::default()),
            update_gate: tokio::sync::Mutex::new(()),
        }
    }

    pub fn acquire(&self, instance_id: &str) -> Result<PluginLease> {
        let routes = self.routes.lock().expect("routes poisoned");
        let generation = routes
            .active
            .get(instance_id)
            .ok_or_else(|| Error::Invalid("plugin is not enabled".into()))?
            .clone();
        Ok(PluginLease { generation })
    }

    pub async fn replace(&self, activation: Activation) -> Result<()> {
        // Only updates serialize. Invocations and lease acquisition do not await this lock.
        let _update = self.update_gate.lock().await;
        let key = activation.grant.key.clone();
        {
            let mut routes = self.routes.lock().expect("routes poisoned");
            if routes
                .highest_generation
                .get(&key.instance_id)
                .is_some_and(|generation| *generation >= key.generation)
            {
                return Err(Error::Invalid(
                    "generation must increase for every activation attempt".into(),
                ));
            }
            if routes
                .active
                .get(&key.instance_id)
                .is_some_and(|current| current.plugin_id != activation.grant.plugin_id)
            {
                return Err(Error::Invalid(
                    "cannot change a plugin's identity during replacement".into(),
                ));
            }
            routes
                .highest_generation
                .insert(key.instance_id.clone(), key.generation);
        }
        let plugin_id = activation.grant.plugin_id.clone();
        self.host.activate(activation).await?;
        let candidate = Arc::new(Generation {
            key: key.clone(),
            plugin_id,
            host: self.host.clone(),
        });
        // Publish only a successfully activated candidate. Host guards failed/cancelled preparation.
        let previous = self
            .routes
            .lock()
            .expect("routes poisoned")
            .active
            .insert(key.instance_id, candidate);
        drop(previous);
        Ok(())
    }

    pub async fn disable(&self, instance_id: &str) {
        let _update = self.update_gate.lock().await;
        let previous = self
            .routes
            .lock()
            .expect("routes poisoned")
            .active
            .remove(instance_id);
        // Existing leases drain naturally; new acquisitions fail immediately.
        drop(previous);
    }
}
