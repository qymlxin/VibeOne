//! Workspace-local filename search, independent of the connected Agent.
use super::*;
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
#[derive(Clone)]
struct Index {
    at: Instant,
    entries: Arc<Vec<(String, bool)>>,
    truncated: bool,
}
static CACHE: OnceLock<Mutex<HashMap<PathBuf, Index>>> = OnceLock::new();

async fn index(root: &Path) -> Result<Index, DomainError> {
    let (bytes, clipped, ok) = git(
        root,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            ".",
        ],
        2 * 1024 * 1024,
    )
    .await?;
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || {
        let dir = cap_std::fs::Dir::open_ambient_dir(&root, cap_std::ambient_authority())
            .map_err(workspace_error)?;
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut paths = BTreeSet::new();
        let mut truncated = clipped;
        if ok {
            for raw in bytes.split(|b| *b == 0).filter(|b| !b.is_empty()) {
                let Ok(path) = std::str::from_utf8(raw) else {
                    continue;
                };
                if resolve(&root, path, false).is_err() {
                    continue;
                }
                let Ok(meta) = dir.symlink_metadata(path) else {
                    continue;
                };
                if !meta.is_file() || meta.is_symlink() {
                    continue;
                }
                paths.insert((path.to_owned(), false));
                let mut parent = Path::new(path).parent();
                while let Some(p) = parent.filter(|p| !p.as_os_str().is_empty()) {
                    paths.insert((p.to_string_lossy().into_owned(), true));
                    parent = p.parent();
                }
                if paths.len() >= 20000 || Instant::now() >= deadline {
                    truncated = true;
                    break;
                }
            }
        } else {
            // Non-Git projects still support references. Never follow symlinks.
            let mut pending = vec![(String::from("."), 0)];
            let mut examined = 0;
            'scan: while let Some((path, depth)) = pending.pop() {
                let entries = dir.read_dir(&path).map_err(resource_error)?;
                for entry in entries {
                    examined += 1;
                    if examined > 20000 || Instant::now() >= deadline {
                        truncated = true;
                        break 'scan;
                    }
                    let entry = entry.map_err(resource_error)?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if matches!(
                        name.as_str(),
                        ".git"
                            | "node_modules"
                            | "target"
                            | "dist"
                            | "build"
                            | "vendor"
                            | ".next"
                            | ".cache"
                    ) {
                        continue;
                    }
                    let kind = entry.file_type().map_err(resource_error)?;
                    if kind.is_symlink() {
                        continue;
                    }
                    let child = if path == "." {
                        name
                    } else {
                        format!("{path}/{name}")
                    };
                    if kind.is_file() {
                        paths.insert((child, false));
                    } else if kind.is_dir() {
                        paths.insert((child.clone(), true));
                        if depth < 32 {
                            pending.push((child, depth + 1));
                        } else {
                            truncated = true;
                        }
                    }
                }
            }
        }
        Ok(Index {
            at: Instant::now(),
            entries: Arc::new(paths.into_iter().collect()),
            truncated,
        })
    })
    .await
    .map_err(|_| DomainError::new(ErrorKind::Internal, "文件搜索任务未完成"))?
}
fn rank(path: &str, query: &str) -> Option<(usize, usize)> {
    let path = path.to_lowercase();
    let query = query.to_lowercase();
    let name = path.rsplit('/').next().unwrap_or(&path);
    if path.starts_with(&query) {
        return Some((0, path.len() - query.len()));
    }
    if name.starts_with(&query) {
        return Some((1, name.len() - query.len()));
    }
    if path.contains(&query) {
        return Some((2, path.len() - query.len()));
    }
    // Ordered character matching handles abbreviated names and partial directory names.
    let mut chars = query.chars();
    let mut next = chars.next();
    let mut gaps = 0;
    for c in path.chars() {
        if Some(c) == next {
            next = chars.next();
            if next.is_none() {
                return Some((3, gaps));
            }
        } else {
            gaps += 1;
        }
    }
    None
}
pub async fn search(workspace: &str, query: &str, refresh: bool) -> Result<Value, DomainError> {
    if query.len() > 1024
        || query.contains('\0')
        || query.starts_with('/')
        || query.split('/').any(|s| s == "..")
    {
        return Err(invalid("请输入当前工作目录内的相对文件名或路径"));
    }
    let root = PathBuf::from(workspace)
        .canonicalize()
        .map_err(workspace_error)?;
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let cached = cache
        .lock()
        .expect("reference index")
        .get(&root)
        .filter(|i| !refresh && i.at.elapsed() < Duration::from_secs(5))
        .cloned();
    let index = if let Some(index) = cached {
        index
    } else {
        let value = index(&root).await?;
        let mut map = cache.lock().expect("reference index");
        if map.len() >= 8 {
            map.clear();
        }
        map.insert(root.clone(), value.clone());
        value
    };
    let query = query.strip_prefix("./").unwrap_or(query);
    let mut matching = index
        .entries
        .iter()
        .filter_map(|(path, directory)| rank(path, query).map(|score| (score, path, *directory)))
        .collect::<Vec<_>>();
    matching.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| b.2.cmp(&a.2))
            .then_with(|| a.1.cmp(b.1))
    });
    let truncated = index.truncated || matching.len() > 60;
    let entries=matching.into_iter().take(60).filter(|(_,path,_)|resolve(&root,path,false).is_ok()).map(|(_,path,directory)|json!({"path":path,"name":path.rsplit('/').next().unwrap_or(path),"kind":if directory{"directory"}else{"file"},"description":Path::new(path).parent().filter(|p|!p.as_os_str().is_empty()).map(|p|p.to_string_lossy().into_owned()).unwrap_or_else(||"项目根目录".into())})).collect::<Vec<_>>();
    Ok(json!({"query":query,"entries":entries,"truncated":truncated,"scope":"workspace"}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn finds_deep_names_partial_paths_and_refreshes_without_following_links() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("docs/guides/examples")).unwrap();
        std::fs::write(root.join("docs/guides/examples/sample.md"), "sample").unwrap();
        let workspace = root.to_str().unwrap();
        assert_eq!(
            search(workspace, "sample", false).await.unwrap()["entries"][0]["path"],
            "docs/guides/examples/sample.md"
        );
        assert_eq!(
            search(workspace, "docs/guid/exam/sa", false).await.unwrap()["entries"][0]["name"],
            "sample.md"
        );
        std::fs::write(root.join("new.txt"), "new").unwrap();
        assert_eq!(
            search(workspace, "new.txt", true).await.unwrap()["entries"][0]["path"],
            "new.txt"
        );
        assert!(search(workspace, "../outside", false).await.is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/", root.join("outside")).unwrap();
            assert!(
                search(workspace, "outside", true).await.unwrap()["entries"]
                    .as_array()
                    .unwrap()
                    .is_empty()
            );
        }
    }
}
