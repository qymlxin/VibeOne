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

#[tokio::test]
async fn permission_and_input_expire_and_reject_late_answers() {
    let (session, mut events) = open(&[]).await;
    for (prompt, request_type, resolved_type) in [
        ("/approve", "permission", "permission_resolved"),
        ("/input", "input", "input_resolved"),
    ] {
        session.prompt(prompt).await.unwrap();
        let request = until(&mut events, |event| event["type"] == request_type).await;
        let id = request["id"].as_str().unwrap();
        tokio::time::pause();
        // Let the receiving handler finish registering its timeout first.
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(601)).await;
        tokio::time::resume();
        let resolved = until(&mut events, |event| {
            event["type"] == resolved_type && event["id"] == id
        })
        .await;
        if request_type == "permission" {
            assert!(resolved["selected"].is_null());
            assert!(session.decide(id, "allow").is_err());
        } else {
            assert!(
                session
                    .answer(
                        id,
                        serde_json::json!({
                            "action":"accept", "content":{"name":"late-answer"}
                        })
                    )
                    .is_err()
            );
        }
        until(&mut events, |event| {
            event["notification"]["update"]["stopReason"] == "end_turn"
        })
        .await;
    }
    session.shutdown().await;
}

#[tokio::test]
async fn initialization_allows_human_input_beyond_the_startup_budget() {
    let (tx, mut events) = mpsc::unbounded_channel();
    let interactions = std::sync::Arc::new(vibeone_agent_client::AgentInteractions::default());
    let control = interactions.clone();
    let task = tokio::spawn(AgentSession::connect_with_interactions(
        "node".into(),
        vec![
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("fixtures/demo-agent.mjs")
                .to_string_lossy()
                .into_owned(),
            "--input-before-session".into(),
        ],
        std::env::current_dir().unwrap(),
        event_sink(move |event| {
            let _ = tx.send(event);
            async { Ok(()) }
        }),
        interactions,
    ));
    let request = until(&mut events, |event| event["type"] == "input").await;
    tokio::time::pause();
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_secs(45)).await;
    tokio::task::yield_now().await;
    let prematurely_finished = task.is_finished();
    tokio::time::resume();
    if prematurely_finished {
        let error = task
            .await
            .unwrap()
            .err()
            .unwrap_or_else(|| "unexpected successful initialization".into());
        panic!("startup interrupted a pending human request: {error}");
    }
    control
        .answer(
            request["id"].as_str().unwrap(),
            serde_json::json!({"action":"accept","content":{"name":"patient-user"}}),
        )
        .unwrap();
    let session = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    session.shutdown().await;
}

fn start_initialization(
    extra: &[&str],
) -> (
    tokio::task::JoinHandle<Result<AgentSession, String>>,
    std::sync::Arc<vibeone_agent_client::AgentInteractions>,
    mpsc::UnboundedReceiver<Value>,
) {
    let (tx, events) = mpsc::unbounded_channel();
    let control = std::sync::Arc::new(vibeone_agent_client::AgentInteractions::default());
    let mut args = vec![
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/demo-agent.mjs")
            .to_string_lossy()
            .into_owned(),
    ];
    args.extend(extra.iter().map(|arg| arg.to_string()));
    let task = tokio::spawn(AgentSession::connect_with_interactions(
        "node".into(),
        args,
        std::env::current_dir().unwrap(),
        event_sink(move |event| {
            let _ = tx.send(event);
            async { Ok(()) }
        }),
        control.clone(),
    ));
    (task, control, events)
}

#[tokio::test]
async fn initialization_resumes_work_timeout_after_human_answer() {
    let (task, control, mut events) =
        start_initialization(&["--input-before-session", "--stall-session"]);
    let request = until(&mut events, |event| event["type"] == "input").await;
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(45)).await;
    tokio::time::resume();
    control
        .answer(
            request["id"].as_str().unwrap(),
            serde_json::json!({"action":"accept","content":{"name":"ready"}}),
        )
        .unwrap();
    until(&mut events, |event| event["type"] == "input_resolved").await;
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(31)).await;
    tokio::task::yield_now().await;
    let finished = task.is_finished();
    tokio::time::resume();
    assert!(
        finished,
        "Agent stalled after the human answer must still time out"
    );
    assert_eq!(
        task.await.unwrap().err().unwrap(),
        "ACP v2 初始化失败或超时"
    );
}

#[tokio::test]
async fn initialization_human_request_still_expires_and_rejects_late_answers() {
    let (task, control, mut events) = start_initialization(&["--input-before-session"]);
    let request = until(&mut events, |event| event["type"] == "input").await;
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(601)).await;
    tokio::task::yield_now().await;
    tokio::time::resume();
    until(&mut events, |event| event["type"] == "input_resolved").await;
    assert!(
        control
            .answer(
                request["id"].as_str().unwrap(),
                serde_json::json!({"action":"cancel"})
            )
            .is_err()
    );
    let error = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap()
        .err()
        .unwrap();
    assert!(error.contains("Session input cancelled"), "{error}");
}

#[cfg(unix)]
#[tokio::test]
async fn aborting_initialization_invalidates_input_and_drains_owned_processes() {
    let marker = format!("VIBEONE_INIT_{}", uuid::Uuid::new_v4());
    let (task, control, mut events) =
        start_initialization(&["--input-before-session", "--child-before-session", &marker]);
    let request = until(&mut events, |event| event["type"] == "input").await;
    let owned = || -> Vec<u32> {
        let output = std::process::Command::new("ps")
            .args(["-axo", "pid=,command="])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|line| line.contains(&marker))
            .filter_map(|line| line.split_whitespace().next()?.parse().ok())
            .collect()
    };
    let processes = owned();
    task.abort();
    assert!(task.await.err().unwrap().is_cancelled());
    assert!(
        control
            .validate_input(
                request["id"].as_str().unwrap(),
                &serde_json::json!({"action":"cancel"})
            )
            .is_err()
    );
    for _ in 0..100 {
        if owned().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let remaining = owned();
    // Clean only fixture processes carrying this test's unique marker if the assertion fails.
    for pid in &remaining {
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .status();
    }
    assert_eq!(
        processes.len(),
        2,
        "both parent and spawned child must exist before cancellation"
    );
    assert!(
        remaining.is_empty(),
        "cancelled initialization leaked its process tree"
    );
}
