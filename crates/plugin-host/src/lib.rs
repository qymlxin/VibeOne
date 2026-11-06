//! Trusted local plugin supervision. Plugin RPC is separate from Agent ACP.
mod rpc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, future::Future, path::PathBuf, pin::Pin};

pub use rpc::PluginHost;
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{code}: {message}")]
    Remote { code: String, message: String },
    #[error("plugin transport closed: {0}")]
    Closed(String),
    #[error("plugin request timed out")]
    Timeout,
    #[error("invalid plugin request: {0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceKey {
    pub instance_id: String,
    pub generation: u64,
}

/// Assigned by the Host, never accepted from an untrusted client/Worker grant list.
#[derive(Clone, Debug)]
pub struct InstanceGrant {
    pub key: InstanceKey,
    pub plugin_id: String,
    pub capabilities: HashSet<String>,
    pub workspaces: HashSet<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCall {
    #[serde(flatten)]
    pub instance: InstanceKey,
    pub plugin_id: String,
    pub request_id: Option<String>,
    pub workspace_id: Option<String>,
    pub capability: String,
    pub operation: String,
    pub input: Value,
}

pub type HostFuture<'a> = Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>>;

/// Receives only requests whose instance, parent invocation and capability were checked.
pub trait HostCapabilityBroker: Send + Sync + 'static {
    fn call(&self, request: HostCall) -> HostFuture<'_>;
}

#[derive(Clone, Debug)]
pub struct Activation {
    pub package_path: PathBuf,
    pub grant: InstanceGrant,
    pub config: Value,
}
