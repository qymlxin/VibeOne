use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use vibeone_plugin_host::{
    Activation, Error, HostCall, HostCapabilityBroker, HostFuture, InstanceGrant, InstanceKey,
    PluginHost,
};

struct EchoBroker;
impl HostCapabilityBroker for EchoBroker {
    fn call(&self, call: HostCall) -> HostFuture<'_> {
        Box::pin(async move { Ok(json!({ "workspace": call.workspace_id, "input": call.input })) })
    }
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}
fn key() -> InstanceKey {
    InstanceKey {
        instance_id: "test".into(),
        generation: 1,
    }
}
fn activation(capabilities: &[&str]) -> Activation {
    Activation {
        package_path: root().join("packages/plugin-runtime/test/fixtures"),
        grant: InstanceGrant {
            key: key(),
            plugin_id: "dev.vibeone.fixture".into(),
            capabilities: capabilities.iter().map(|value| value.to_string()).collect(),
            workspaces: HashSet::from(["authorized".into()]),
        },
        config: json!({"from": "rust"}),
    }
}
async fn host() -> PluginHost {
    let runner = root().join("packages/plugin-runtime/dist/main.js");
    assert!(
        runner.exists(),
        "Run npm ci && npm run build before cargo test"
    );
    PluginHost::spawn(Path::new("node"), &runner, Arc::new(EchoBroker))
        .await
        .unwrap()
}

#[tokio::test]
async fn rust_node_bidirectional_rpc_progress_and_authorization() {
    let host = host().await;
    host.activate(activation(&["diagnostics.read"]))
        .await
        .unwrap();
    let mut events = host.subscribe();
    let result = host
        .invoke(
            &key(),
            "reverse",
            json!({"hello": "node"}),
            Some("authorized"),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
    assert_eq!(
        result,
        json!({"workspace": "authorized", "input": {"hello": "node"}})
    );
    assert!(
        host.invoke(
            &key(),
            "reverse",
            Value::Null,
            Some("forbidden"),
            Duration::from_secs(2)
        )
        .await
        .is_err()
    );
    host.invoke(
        &key(),
        "progress",
        Value::Null,
        None,
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    let event = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(event["value"]["percent"], 50);
    host.shutdown().await.unwrap();
}

#[tokio::test]
async fn rust_denies_ungranted_capabilities_and_cancels_dropped_invocations() {
    let host = host().await;
    host.activate(activation(&[])).await.unwrap();
    let error = host
        .invoke(&key(), "reverse", Value::Null, None, Duration::from_secs(2))
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Remote { code, .. } if code == "host_denied"));
    let cancelled = tokio::time::timeout(
        Duration::from_millis(20),
        host.invoke(&key(), "wait", Value::Null, None, Duration::from_secs(2)),
    )
    .await;
    assert!(cancelled.is_err());
    let inspected = host
        .invoke(&key(), "inspect", Value::Null, None, Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(inspected["config"]["from"], "rust");
    host.deactivate(&key()).await.unwrap();
    assert!(
        host.invoke(&key(), "inspect", Value::Null, None, Duration::from_secs(2))
            .await
            .is_err()
    );
    host.shutdown().await.unwrap();
}

#[tokio::test]
async fn node_crash_fails_waiting_calls_instead_of_hanging() {
    let host = host().await;
    host.activate(activation(&[])).await.unwrap();
    let key = key();
    let invoke = host.invoke(&key, "wait", Value::Null, None, Duration::from_secs(2));
    let kill = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        host.terminate().unwrap();
    };
    let (result, _) =
        tokio::time::timeout(Duration::from_secs(3), async { tokio::join!(invoke, kill) })
            .await
            .unwrap();
    assert!(matches!(result, Err(Error::Closed(_))));
    host.shutdown().await.unwrap();
}
