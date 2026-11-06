use std::path::{Path, PathBuf};

pub fn target() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("VIBEONE_DATA_DIR") {
        let path = PathBuf::from(path);
        return path
            .is_absolute()
            .then_some(path)
            .ok_or("VIBEONE_DATA_DIR 必须是绝对路径".into());
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".vibeone"))
        .ok_or("无法确定用户目录".into())
}

pub fn current(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let target = target()?;
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(if !target.exists() && legacy.is_dir() {
        legacy
    } else {
        target
    })
}

// Caller stops the old Host first. Retain its path as an alias so pinned plugin
// executables and in-flight launch specifications keep resolving to the same files.
pub fn migrate(legacy: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        return Err("目标数据目录已存在，不覆盖已有数据".into());
    }
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(legacy.join("host.lock"))
        .map_err(|error| error.to_string())?;
    lock.try_lock()
        .map_err(|_| "旧 Host 尚未退出，数据尚未迁移")?;
    std::fs::rename(legacy, target)
        .map_err(|error| format!("数据目录迁移失败，原数据已保留：{error}"))?;
    #[cfg(unix)]
    let alias = std::os::unix::fs::symlink(target, legacy);
    #[cfg(windows)]
    let alias = std::os::windows::fs::symlink_dir(target, legacy);
    if let Err(error) = alias {
        std::fs::rename(target, legacy).map_err(|rollback| {
            format!(
                "数据位于 {}；旧路径恢复失败：{rollback}；{error}",
                target.display()
            )
        })?;
        return Err(format!("未能保留旧目录别名，已恢复原数据：{error}"));
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_database_and_pinned_paths_without_overwriting_existing_data() {
        let root = std::env::temp_dir().join(format!(
            "vibeone-paths-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let old = root.join("old");
        let new = root.join(".vibeone");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("vibeone.sqlite3"), b"retained").unwrap();
        let pinned = old.join("plugin.js");
        std::fs::write(&pinned, b"plugin").unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(old.join("host.lock"))
            .unwrap();
        lock.try_lock().unwrap();
        assert!(migrate(&old, &new).is_err());
        assert!(!new.exists());
        drop(lock);
        migrate(&old, &new).unwrap();
        assert!(old.is_symlink());
        assert_eq!(
            std::fs::read(new.join("vibeone.sqlite3")).unwrap(),
            b"retained"
        );
        assert_eq!(std::fs::read(&pinned).unwrap(), b"plugin");
        assert!(migrate(&old, &new).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
