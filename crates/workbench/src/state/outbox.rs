use super::*;
impl Workbench {
    pub(crate) fn start_outbox(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                tick.tick().await;
                let Some(workbench) = weak.upgrade() else {
                    break;
                };
                if workbench.available().is_err() {
                    break;
                }
                let records = match workbench.store.pending_notifications().await {
                    Ok(records) => records,
                    Err(error) => {
                        workbench.fail_storage(error);
                        break;
                    }
                };
                for record in records {
                    if workbench.available().is_err() {
                        return;
                    }
                    let id = record["id"].as_str().unwrap_or_default();
                    let session = record["sessionId"].as_str().unwrap_or_default();
                    let event = &record["payload"];
                    let attempts = record["attempts"].as_u64().unwrap_or(0) as u32 + 1;
                    let obsolete = if event["type"] == "attention.created" {
                        match workbench.entry(session) {
                            Ok(entry) => {
                                let _gate = entry.gate.lock().await;
                                let view = entry.view.lock().expect("view poisoned");
                                !view
                                    .approvals
                                    .iter()
                                    .chain(&view.inputs)
                                    .any(|request| event["requestId"] == request.id)
                            }
                            Err(_) => true,
                        }
                    } else {
                        false
                    };
                    let state = if obsolete {
                        "obsolete"
                    } else {
                        match workbench
                            .plugins
                            .deliver_notification(&workbench, event)
                            .await
                        {
                            Ok(()) => "delivered",
                            Err(error) => {
                                eprintln!("notification delivery failed ({id}): {error}");
                                if attempts >= 3 { "failed" } else { "pending" }
                            }
                        }
                    };
                    if let Err(error) = workbench
                        .store
                        .notification_result(id, state, attempts)
                        .await
                    {
                        workbench.fail_storage(error);
                        return;
                    }
                }
            }
        });
    }
}
