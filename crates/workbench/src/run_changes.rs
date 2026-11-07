//! Bounded, read-only execution-window snapshots. Never touches the user's Git index.
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

pub struct Snapshot(BTreeMap<String, Vec<u8>>);
pub async fn capture(workspace: &str) -> Result<Snapshot, String> {
    let workspace = workspace.to_owned();
    tokio::time::timeout(std::time::Duration::from_secs(10), async move {
        let output = crate::files::git_command(Path::new(&workspace))
            .args([
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                ".",
            ])
            .output()
            .await
            .map_err(|_| "无法列出工作目录文件")?;
        if !output.status.success() || output.stdout.len() > 2 * 1024 * 1024 {
            return Err("当前目录无法采集 Git 文件快照".into());
        }
        tokio::task::spawn_blocking(move || {
            let root = cap_std::fs::Dir::open_ambient_dir(&workspace, cap_std::ambient_authority())
                .map_err(|e| e.to_string())?;
            let mut files = BTreeMap::new();
            let mut total = 0;
            for path in output.stdout.split(|b| *b == 0).filter(|s| !s.is_empty()) {
                let path = std::str::from_utf8(path).map_err(|_| "文件名编码不支持")?;
                if Path::new(path).is_absolute()
                    || Path::new(path)
                        .components()
                        .any(|c| !matches!(c, std::path::Component::Normal(_)))
                {
                    return Err("文件路径不支持".into());
                }
                let meta = match root.symlink_metadata(path) {
                    Ok(m) => m,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(e) => return Err(e.to_string()),
                };
                if !meta.is_file() {
                    continue;
                }
                // Reject symlink ancestors, including links back into the workspace.
                let mut ancestor = Path::new(path).parent();
                while let Some(p) = ancestor.filter(|p| !p.as_os_str().is_empty()) {
                    if root
                        .symlink_metadata(p)
                        .map_err(|e| e.to_string())?
                        .is_symlink()
                    {
                        return Err("快照路径包含符号链接".into());
                    }
                    ancestor = p.parent();
                }
                let mut bytes = vec![];
                root.open(path)
                    .map_err(|e| e.to_string())?
                    .take(4 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                total += bytes.len();
                if bytes.len() > 4 * 1024 * 1024 || total > 64 * 1024 * 1024 || files.len() >= 10000
                {
                    return Err("工作目录超过本轮快照上限".into());
                }
                files.insert(path.to_owned(), bytes);
            }
            Ok(Snapshot(files))
        })
        .await
        .map_err(|e| e.to_string())?
    })
    .await
    .map_err(|_| "采集本轮快照超时".to_owned())?
}
pub async fn compare(before: Snapshot, after: Snapshot) -> Value {
    let mut files = vec![];
    let mut added = 0u64;
    let mut removed = 0u64;
    let mut budget = 1024 * 1024usize;
    let paths: std::collections::BTreeSet<_> = before.0.keys().chain(after.0.keys()).collect();
    for path in paths {
        let old = before.0.get(path);
        let new = after.0.get(path);
        if old == new {
            continue;
        }
        let binary = old
            .into_iter()
            .chain(new)
            .any(|b| b.contains(&0) || std::str::from_utf8(b).is_err());
        let size = old.map_or(0, Vec::len) + new.map_or(0, Vec::len);
        let preview = !binary && size <= budget && size <= 256 * 1024;
        let mut file = json!({"path":path,"status":if old.is_none(){"A"}else if new.is_none(){"D"}else{"M"},"binary":binary,"previewAvailable":preview});
        if preview {
            budget -= size;
            file["oldText"] = old
                .map(|b| json!(std::str::from_utf8(b).unwrap()))
                .unwrap_or(Value::Null);
            file["newText"] = new
                .map(|b| json!(std::str::from_utf8(b).unwrap()))
                .unwrap_or(Value::Null);
        }
        // Git's line accounting, without changing index, HEAD or worktree.
        if !binary && let Ok(dir) = tempfile::tempdir() {
            let a = dir.path().join("before");
            let b = dir.path().join("after");
            if tokio::fs::write(&a, old.map_or(&[][..], Vec::as_slice))
                .await
                .is_ok()
                && tokio::fs::write(&b, new.map_or(&[][..], Vec::as_slice))
                    .await
                    .is_ok()
            {
                if let Ok(Ok(out)) = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    crate::files::git_command(dir.path())
                        .args([
                            "diff",
                            "--no-index",
                            "--numstat",
                            "--no-ext-diff",
                            "--no-textconv",
                            "--",
                        ])
                        .arg(&a)
                        .arg(&b)
                        .output(),
                )
                .await
                {
                    let text = String::from_utf8_lossy(&out.stdout);
                    let mut cols = text.split('\t');
                    if let (Some(a), Some(r)) = (
                        cols.next().and_then(|s| s.parse::<u64>().ok()),
                        cols.next().and_then(|s| s.parse::<u64>().ok()),
                    ) {
                        file["added"] = json!(a);
                        file["removed"] = json!(r);
                        added += a;
                        removed += r;
                    }
                }
            }
        }
        files.push(file);
    }
    json!({"available":true,"files":files,"added":added,"removed":removed,"notice":"执行开始到结束的文件内容差异，可能包含期间其他工具的修改。"})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn dirty_before_greeting_then_edit_create_delete() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        crate::files::git_command(root)
            .args(["init", "-q"])
            .output()
            .await
            .unwrap();
        tokio::fs::write(root.join("dirty.md"), "already dirty\n")
            .await
            .unwrap();
        let before = capture(root.to_str().unwrap()).await.unwrap();
        let same = capture(root.to_str().unwrap()).await.unwrap();
        assert!(
            compare(before, same).await["files"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let before = capture(root.to_str().unwrap()).await.unwrap();
        tokio::fs::write(root.join("dirty.md"), "new content\n")
            .await
            .unwrap();
        tokio::fs::write(root.join("new.md"), "created\n")
            .await
            .unwrap();
        let delta = compare(before, capture(root.to_str().unwrap()).await.unwrap()).await;
        assert_eq!(delta["files"].as_array().unwrap().len(), 2);
        assert_eq!(delta["added"], 2);
        assert_eq!(delta["removed"], 1);
        assert_eq!(delta["files"][0]["oldText"], "already dirty\n");
        let before = capture(root.to_str().unwrap()).await.unwrap();
        tokio::fs::remove_file(root.join("dirty.md")).await.unwrap();
        assert_eq!(
            compare(before, capture(root.to_str().unwrap()).await.unwrap()).await["files"][0]["status"],
            "D"
        );
    }
}
