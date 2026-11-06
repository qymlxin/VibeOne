//! Coalesced session projections at one committed cursor, never raw protocol deltas.
use super::*;

pub(crate) struct SyncView {
    pub snapshot: Value,
    pub epoch: String,
    pub changed: HashMap<String, u64>,
    pub reset: Option<&'static str>,
}

impl Workbench {
    pub(crate) async fn sync_view(
        &self,
        after: Option<u64>,
        epoch: Option<&str>,
    ) -> Result<SyncView, String> {
        // Writers hold this from the SQLite commit through in-memory publication.
        // Otherwise a higher cursor could be published before an earlier session view.
        let _sync = self.sync_gate.lock().await;
        let snapshot = self.snapshot();
        let cursor = snapshot["revision"].as_u64().unwrap_or(0);
        let reset = match after {
            None => Some("initial"),
            Some(_) if epoch != Some(self.sync_epoch.as_str()) => Some("epoch"),
            Some(after) if after > cursor => Some("future"),
            Some(after) if cursor - after > 4096 => Some("expired"),
            _ if snapshot["storageError"].is_string() => Some("storage"),
            _ => None,
        };
        let mut changed = HashMap::new();
        if reset.is_none() {
            changed.extend(
                self.store
                    .changed_sessions(after.unwrap(), cursor)
                    .await
                    .map_err(|e| e.to_string())?,
            );
        }
        Ok(SyncView {
            snapshot,
            epoch: self.sync_epoch.clone(),
            changed,
            reset,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn old_cursors_reset_without_losing_the_committed_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        let first = workbench.sync_view(None, None).await.unwrap();
        for index in 0..4097 {
            workbench
                .put_catalog("sync-test", "one", json!({"value":index}))
                .await
                .unwrap();
        }
        let sync = workbench
            .sync_view(Some(0), Some(&first.epoch))
            .await
            .unwrap();
        assert_eq!(sync.reset, Some("expired"));
        assert_eq!(sync.snapshot["revision"], 4097);
        assert!(sync.changed.is_empty());
        let current = workbench
            .sync_view(Some(4097), Some(&first.epoch))
            .await
            .unwrap();
        assert_eq!(current.reset, None);
        workbench.close().await;
    }
}
