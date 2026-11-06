//! Coalesced session projections at one committed cursor, never raw protocol deltas.
use super::*;

pub(crate) struct SyncView {
    pub snapshot: crate::contracts::SnapshotResponse,
    pub epoch: String,
    pub changed: HashMap<String, u64>,
    pub reset: Option<&'static str>,
}

impl Workbench {
    pub(crate) async fn sync_view(
        &self,
        after: Option<u64>,
        epoch: Option<&str>,
    ) -> Result<SyncView, DomainError> {
        // Writers hold this from the SQLite commit through in-memory publication.
        // Otherwise a higher cursor could be published before an earlier session view.
        let _sync = self.sync_gate.lock().await;
        let snapshot = self.snapshot_view();
        let cursor = snapshot.metadata.revision;
        let reset = match after {
            None => Some("initial"),
            Some(_) if epoch != Some(self.sync_epoch.as_str()) => Some("epoch"),
            Some(after) if after > cursor => Some("future"),
            Some(after) if cursor - after > 4096 => Some("expired"),
            _ if snapshot.metadata.storage_error.is_some() => Some("storage"),
            _ => None,
        };
        let mut changed = HashMap::new();
        if reset.is_none() {
            changed.extend(
                self.store
                    .changed_sessions(after.unwrap(), cursor)
                    .await
                    .map_err(|error| {
                        self.fail_storage(error);
                        DomainError::storage()
                    })?,
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
    async fn read_failure_is_typed_and_the_next_sync_preserves_a_cached_reset() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        let initial = workbench.sync_view(None, None).await.unwrap();
        workbench.store.close().await;
        let error = workbench
            .sync_view(
                Some(initial.snapshot.metadata.revision),
                Some(&initial.epoch),
            )
            .await
            .err()
            .expect("closed storage must fail the incremental read");
        assert_eq!(error.kind, ErrorKind::StorageUnavailable);
        assert!(!error.message.contains(directory.path().to_str().unwrap()));
        let recovered = workbench
            .sync_view(
                Some(initial.snapshot.metadata.revision),
                Some(&initial.epoch),
            )
            .await
            .unwrap();
        assert_eq!(recovered.reset, Some("storage"));
        assert!(recovered.snapshot.metadata.storage_error.is_some());
        assert!(recovered.changed.is_empty());
        workbench.close().await;
    }
    #[tokio::test]
    async fn event_pages_validate_cursors_and_never_publish_raw_fault_details() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        assert_eq!(
            workbench
                .event_page(i64::MAX as u64 + 1)
                .await
                .unwrap_err()
                .kind,
            ErrorKind::InvalidInput
        );
        assert!(workbench.snapshot_view().metadata.storage_error.is_none());
        workbench.store.close().await;
        let error = workbench.event_page(0).await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::StorageUnavailable);
        workbench.fail_storage("PRIVATE_DATABASE_DETAIL");
        assert!(
            !workbench
                .snapshot_view()
                .metadata
                .storage_error
                .unwrap()
                .contains("PRIVATE_DATABASE_DETAIL")
        );
        assert_eq!(
            workbench.event_page(0).await.unwrap_err().kind,
            ErrorKind::StorageUnavailable
        );
        workbench.close().await;
    }
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
        assert_eq!(sync.snapshot.metadata.revision, 4097);
        assert!(sync.changed.is_empty());
        let current = workbench
            .sync_view(Some(4097), Some(&first.epoch))
            .await
            .unwrap();
        assert_eq!(current.reset, None);
        workbench.close().await;
    }
}
