use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vibeone_plugin_host::{Error, HostCall, HostCapabilityBroker, HostFuture, Result};

/// P0 broker: one explicitly selected, read-only workspace. No shell or arbitrary FS API.
pub struct WorkspaceBroker {
    id: String,
    root: Arc<PathBuf>,
}

impl WorkspaceBroker {
    pub fn new(id: &str, root: PathBuf) -> Result<Self> {
        let root = root.canonicalize()?;
        if !root.is_dir() {
            return Err(Error::Invalid("workspace must be a directory".into()));
        }
        Ok(Self {
            id: id.into(),
            root: Arc::new(root),
        })
    }
}

impl HostCapabilityBroker for WorkspaceBroker {
    fn call(&self, call: HostCall) -> HostFuture<'_> {
        Box::pin(async move {
            if call.capability != "workspace.read"
                || call.operation != "scan"
                || call.workspace_id.as_deref() != Some(&self.id)
            {
                return Err(Error::Invalid(
                    "unsupported workspace operation or scope".into(),
                ));
            }
            let root = self.root.clone();
            let path = match call.input.get("path") {
                None => ".".to_owned(),
                Some(Value::String(path)) => path.clone(),
                _ => return Err(Error::Invalid("path must be a string".into())),
            };
            tokio::task::spawn_blocking(move || scan(&root, &path))
                .await
                .map_err(|error| Error::Closed(error.to_string()))?
        })
    }
}

fn scan(root: &Path, relative: &str) -> Result<Value> {
    if Path::new(relative).is_absolute() {
        return Err(Error::Invalid("workspace path must be relative".into()));
    }
    let directory = root.join(relative).canonicalize()?;
    if !directory.starts_with(root) {
        return Err(Error::Invalid(
            "workspace path escapes authorized root".into(),
        ));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in std::fs::read_dir(&directory)? {
        if entries.len() == 500 {
            truncated = true;
            break;
        }
        let entry = entry?;
        let kind = entry.file_type()?;
        entries.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "kind": if kind.is_symlink() { "symlink" } else if kind.is_dir() { "directory" } else { "file" },
        }));
    }
    entries.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(
        json!({"path": directory.strip_prefix(root).unwrap_or(Path::new(".")).to_string_lossy(), "entries": entries, "truncated": truncated}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_absolute_paths_and_parent_traversal() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .unwrap();
        assert!(scan(&root, "/").is_err());
        assert!(scan(&root, "..").is_err());
        assert!(
            scan(&root, ".").unwrap()["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["name"] == "Cargo.toml")
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let root = std::env::temp_dir().join(format!("vibeone-scan-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink("/", root.join("outside")).unwrap();
        let result = scan(&root.canonicalize().unwrap(), "outside");
        std::fs::remove_dir_all(root).unwrap();
        assert!(result.is_err());
    }
}
