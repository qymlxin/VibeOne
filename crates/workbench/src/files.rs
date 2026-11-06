use serde_json::{Value, json};
use std::{
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::io::AsyncReadExt;

pub fn resolve(root: &Path, relative: &str, deleted: bool) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("路径必须位于工作区内".into());
    }
    let root = root.canonicalize().map_err(|_| "工作区不存在")?;
    let path = root.join(relative);
    let resolved = match path.canonicalize() {
        Ok(path) => path,
        Err(_) if deleted => path
            .parent()
            .ok_or("路径无效")?
            .canonicalize()
            .map_err(|_| "父目录不存在")?
            .join(path.file_name().ok_or("路径无效")?),
        Err(_) => return Err("文件不存在".into()),
    };
    if !resolved.starts_with(&root) {
        return Err("符号链接指向工作区以外".into());
    }
    Ok(resolved)
}
async fn git(root: &Path, args: &[&str], limit: u64) -> Result<(Vec<u8>, bool, bool), String> {
    let mut command = tokio::process::Command::new("git");
    command
        .args(["-c", "core.fsmonitor=false"])
        .arg("--no-pager")
        .arg("--literal-pathspecs")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|_| "未找到 Git")?;
    let mut stdout = child.stdout.take().ok_or("Git 输出不可用")?.take(limit + 1);

    tokio::time::timeout(Duration::from_secs(8), async {
        let mut bytes = vec![];
        stdout
            .read_to_end(&mut bytes)
            .await
            .map_err(|error| error.to_string())?;
        let truncated = bytes.len() as u64 > limit;
        if truncated {
            let _ = child.kill().await;
            bytes.truncate(limit as usize);
        }
        let success = child
            .wait()
            .await
            .map_err(|error| error.to_string())?
            .success();
        Ok::<_, String>((bytes, truncated, success))
    })
    .await
    .map_err(|_| "Git 查询超时")?
}
pub async fn changes(workspace: &str) -> Result<Value, String> {
    let root = PathBuf::from(workspace)
        .canonicalize()
        .map_err(|_| "工作区已移动或删除")?;
    let (git_root, _, is_git) = git(&root, &["rev-parse", "--show-toplevel"], 8192).await?;
    if !is_git {
        return Ok(json!({"isGit":false,"files":[],"notice":"工作区不是 Git 仓库"}));
    }
    let git_root = PathBuf::from(String::from_utf8_lossy(&git_root).trim());
    let (branch, _, _) = git(&root, &["symbolic-ref", "--short", "HEAD"], 4096).await?;
    let (bytes, truncated, _) = git(
        &root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=normal",
            "--",
            ".",
        ],
        1024 * 1024,
    )
    .await?;
    let mut records = bytes.split(|byte| *byte == 0);
    let mut files = vec![];
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let status = String::from_utf8_lossy(&record[..2]);
        let path = String::from_utf8_lossy(&record[3..]);
        if record[0] == b'R' || record[0] == b'C' {
            let _ = records.next();
        }
        let full = git_root.join(path.as_ref());
        let Ok(relative) = full.strip_prefix(&root) else {
            continue;
        };
        files.push(json!({"path":relative.to_string_lossy(),"status":status,"staged":record[0]!=b' ' && record[0]!=b'?',"unstaged":record[1]!=b' ' && record[1]!=b'?',"untracked":status=="??"}));
    }
    Ok(
        json!({"isGit":true,"branch":String::from_utf8_lossy(&branch).trim(),"files":files,"truncated":truncated,"collectedAt":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),"notice":"这是工作区当前变更，可能包含用户和其他工具的修改。"}),
    )
}
pub async fn diff(workspace: &str, path: &str, staged: bool) -> Result<Value, String> {
    let root = PathBuf::from(workspace)
        .canonicalize()
        .map_err(|_| "工作区不存在")?;
    resolve(&root, path, true)?;
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    let (bytes, truncated, success) = git(&root, &args, 256 * 1024).await?;
    if !success && !truncated {
        return Err("无法读取 Git 差异".into());
    }
    Ok(
        json!({"path":path,"staged":staged,"text":String::from_utf8_lossy(&bytes),"truncated":truncated}),
    )
}
pub async fn read(workspace: &str, path: &str) -> Result<Value, String> {
    resolve(Path::new(workspace), path, false)?;
    let root = workspace.to_owned();
    let path = path.to_owned();
    tokio::task::spawn_blocking(move||{
        use std::io::Read;
        let directory=cap_std::fs::Dir::open_ambient_dir(&root,cap_std::ambient_authority()).map_err(|error|error.to_string())?;
        let file=directory.open(&path).map_err(|error|format!("无法在授权工作区读取文件：{error}"))?;
        let metadata=file.metadata().map_err(|error|error.to_string())?;
        if !metadata.is_file(){return Err("请选择文件".into());}
        let mut bytes=vec![];file.take(256*1024+1).read_to_end(&mut bytes).map_err(|error|error.to_string())?;
        let truncated=bytes.len()>256*1024;bytes.truncate(256*1024);
        let binary=bytes.contains(&0)||std::str::from_utf8(&bytes).is_err();
        Ok(json!({"path":path,"size":metadata.len(),"binary":binary,"truncated":truncated,"text":if binary{String::new()}else{String::from_utf8_lossy(&bytes).into_owned()}}))
    }).await.map_err(|error|error.to_string())?
}
pub async fn tree(workspace: &str, path: &str) -> Result<Value, String> {
    resolve(Path::new(workspace), path, false)?;
    let root = workspace.to_owned();
    let path = path.to_owned();
    tokio::task::spawn_blocking(move||{
        let directory=cap_std::fs::Dir::open_ambient_dir(&root,cap_std::ambient_authority()).map_err(|error|error.to_string())?;
        let mut entries=vec![];
        for entry in directory.read_dir(&path).map_err(|error|error.to_string())? {
            let entry=entry.map_err(|error|error.to_string())?;let name=entry.file_name().to_string_lossy().into_owned();if name==".git"{continue;}
            let kind=entry.file_type().map_err(|error|error.to_string())?;
            entries.push(json!({"name":name,"path":Path::new(&path).join(&name).to_string_lossy(),"kind":if kind.is_symlink(){"symlink"}else if kind.is_dir(){"directory"}else{"file"}}));if entries.len()==300{break;}
        }
        entries.sort_by(|a,b|a["name"].as_str().cmp(&b["name"].as_str()));
        Ok(json!({"path":path,"truncated":entries.len()==300,"entries":entries}))
    }).await.map_err(|error|error.to_string())?
}

/// References are workspace-relative files, or directories marked by a trailing slash.
/// Directory context contains names only; it never recursively reads file contents.
pub async fn reference(workspace: &str, path: &str) -> Result<String, String> {
    if path.ends_with('/') {
        let listing = tree(workspace, path).await?;
        let mut names = String::new();
        for entry in listing["entries"].as_array().ok_or("目录内容无效")? {
            if entry["kind"] == "symlink" {
                continue;
            }
            let name = entry["name"].as_str().ok_or("目录名称无效")?;
            // JSON string encoding preserves unusual names without introducing fake rows.
            let row = format!(
                "{}{}\n",
                serde_json::to_string(name).map_err(|e| e.to_string())?,
                if entry["kind"] == "directory" {
                    " /"
                } else {
                    ""
                }
            );
            if names.len() + row.len() > 32768 {
                names.push_str("（目录清单已截断）\n");
                break;
            }
            names.push_str(&row);
        }
        if listing["truncated"] == true {
            names.push_str("（目录仅列出前 300 项）\n");
        }
        return Ok(format!(
            "用户引用的工作区文件夹 {path}（执行前读取，仅当前层目录清单，不含文件正文）：\n{names}"
        ));
    }
    let content = read(workspace, path).await?;
    if content["binary"] == true
        || content["truncated"] == true
        || content["size"].as_u64().unwrap_or(0) > 32768
    {
        return Err("引用文件须为不超过 32 KiB 的文本文件".into());
    }
    Ok(format!(
        "用户引用的工作区文件 {path}（执行前读取）：\n{}",
        content["text"].as_str().unwrap_or_default()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_reject_traversal_and_symlinks() {
        let root = tempfile::tempdir().unwrap();
        assert!(resolve(root.path(), "../secrets", true).is_err());
        assert!(resolve(root.path(), "/etc/passwd", false).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/", root.path().join("outside")).unwrap();
            assert!(resolve(root.path(), "outside/etc/passwd", false).is_err());
        }
    }
}
