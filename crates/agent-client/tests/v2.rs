use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::mpsc;
use vibeone_agent_client::{AgentSession, event_sink};

async fn open(extra: &[&str]) -> (AgentSession, mpsc::UnboundedReceiver<Value>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/demo-agent.mjs");
    let mut args = vec![fixture.to_string_lossy().into_owned()];
    args.extend(extra.iter().map(|value| value.to_string()));
    let session = AgentSession::connect(
        PathBuf::from("node"),
        args,
        std::env::current_dir().unwrap(),
        event_sink(move |event| {
            let _ = tx.send(event);
            async { Ok(()) }
        }),
    )
    .await
    .unwrap();
    (session, rx)
}

async fn until(
    rx: &mut mpsc::UnboundedReceiver<Value>,
    predicate: impl Fn(&Value) -> bool,
) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = rx.recv().await.expect("event stream closed");
            if predicate(&event) {
                return event;
            }
        }
    })
    .await
    .expect("expected event timed out")
}

#[tokio::test]
async fn v2_acceptance_is_independent_from_stream_and_idle_completion() {
    let (session, mut events) = open(&[]).await;
    let accepted = session.prompt("hello").await.unwrap();
    assert!(accepted["messageId"].is_string());
    let mut text = String::new();
    until(&mut events, |event| {
        event["notification"]["update"]["state"] == "running"
    })
    .await;
    loop {
        let event = until(&mut events, |_| true).await;
        let update = &event["notification"]["update"];
        if update["sessionUpdate"] == "agent_message_chunk" {
            text.push_str(update["content"]["text"].as_str().unwrap());
        }
        if update["state"] == "idle" && update["stopReason"] == "end_turn" {
            break;
        }
    }
    assert!(text.contains("hello"));
}

#[tokio::test]
async fn permission_selection_and_cancel_work_while_updates_are_pending() {
    let (session, mut events) = open(&[]).await;
    session.prompt("/approve").await.unwrap();
    let permission = until(&mut events, |event| event["type"] == "permission").await;
    let id = permission["id"].as_str().unwrap();
    assert!(session.decide(id, "invented-option").is_err());
    session.decide(id, "allow").unwrap();
    assert!(session.decide(id, "allow").is_err());
    until(&mut events, |event| {
        event["notification"]["update"]["stopReason"] == "end_turn"
    })
    .await;
    session.prompt("/wait").await.unwrap();
    session.cancel().unwrap();
    until(&mut events, |event| {
        event["notification"]["update"]["stopReason"] == "cancelled"
    })
    .await;
}

#[tokio::test]
async fn v1_response_is_rejected_instead_of_silent_downgrade() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/demo-agent.mjs");
    let result = AgentSession::connect(
        "node".into(),
        vec![fixture.to_string_lossy().into_owned(), "--v1".into()],
        std::env::current_dir().unwrap(),
        event_sink(|_| async { Ok(()) }),
    )
    .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn malformed_handshake_and_crashed_agent_fail_without_hanging() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/demo-agent.mjs");
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        AgentSession::connect(
            "node".into(),
            vec![fixture.to_string_lossy().into_owned(), "--malformed".into()],
            std::env::current_dir().unwrap(),
            event_sink(|_| async { Ok(()) }),
        ),
    )
    .await
    .unwrap();
    assert!(result.is_err());
    let (session, mut events) = open(&["--crash"]).await;
    let result = tokio::time::timeout(Duration::from_secs(5), session.prompt("crash fixture"))
        .await
        .unwrap();
    assert!(result.is_err());
    until(&mut events, |event| event["type"] == "disconnected").await;
}
