use crate::domain_error::{DomainError, ErrorKind};
use serde_json::{Value, json};
use std::{
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::io::AsyncReadExt;

fn workspace_error(error: std::io::Error) -> DomainError {
    DomainError::new(
        match error.kind() {
            std::io::ErrorKind::NotFound => ErrorKind::WorkspaceNotFound,
            std::io::ErrorKind::PermissionDenied => ErrorKind::WorkspaceForbidden,
            _ => ErrorKind::WorkspaceUnavailable,
        },
        "工作区不可访问，请检查目录及权限",
    )
}
fn resource_error(error: std::io::Error) -> DomainError {
    DomainError::new(
        match error.kind() {
            std::io::ErrorKind::NotFound => ErrorKind::ResourceNotFound,
            std::io::ErrorKind::PermissionDenied => ErrorKind::ResourceForbidden,
            std::io::ErrorKind::InvalidInput
            | std::io::ErrorKind::NotADirectory
            | std::io::ErrorKind::IsADirectory => ErrorKind::InvalidInput,
            _ => ErrorKind::ResourceUnavailable,
        },
        "文件或目录不可访问，请检查路径、类型及权限",
    )
}
fn forbidden() -> DomainError {
    DomainError::new(
        ErrorKind::ResourceForbidden,
        "路径或符号链接必须位于授权工作区内",
    )
}
fn invalid(message: &str) -> DomainError {
    DomainError::new(ErrorKind::InvalidInput, message)
}
pub fn resolve(root: &Path, relative: &str, deleted: bool) -> Result<PathBuf, DomainError> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(forbidden());
    }
    let root = root.canonicalize().map_err(workspace_error)?;
    let path = root.join(relative);
    match path.canonicalize() {
        Ok(resolved) => {
            if resolved.starts_with(&root) {
                Ok(resolved)
            } else {
                Err(forbidden())
            }
        }
        Err(error) if deleted && error.kind() == std::io::ErrorKind::NotFound => {
            // A broken existing link is not a deleted path. Do not weaken its boundary.
            if std::fs::symlink_metadata(&path).is_ok() {
                return Err(forbidden());
            }
            for parent in path.ancestors().skip(1) {
                match parent.canonicalize() {
                    Ok(resolved) => {
                        if !resolved.starts_with(&root) {
                            return Err(forbidden());
                        }
                        let suffix = path.strip_prefix(parent).map_err(|_| invalid("路径无效"))?;
                        return Ok(resolved.join(suffix));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        if std::fs::symlink_metadata(parent).is_ok() {
                            return Err(forbidden());
                        }
                    }
                    Err(error) => return Err(resource_error(error)),
                }
            }
            Err(invalid("路径没有可访问的父目录"))
        }
        Err(error) => Err(resource_error(error)),
    }
}
pub(crate) fn git_command(root: &Path) -> tokio::process::Command {
    let mut command = tokio::process::Command::new("git");
    // Repository/worktree/index overrides must never redirect a workspace query.
    for (name, _) in std::env::vars_os() {
        if name
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
        {
            command.env_remove(name);
        }
    }
    command
        .args(["-c", "core.fsmonitor=false"])
        .arg("--no-pager")
        .arg("--literal-pathspecs")
        .arg("-C")
        .arg(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    command
}
async fn git(root: &Path, args: &[&str], limit: u64) -> Result<(Vec<u8>, bool, bool), DomainError> {
    let mut command = git_command(root);
    command.args(args).stdout(std::process::Stdio::piped());
    let mut child = command.spawn().map_err(|_| {
        DomainError::new(
            ErrorKind::GitUnavailable,
            "Git 入口不可用，请检查安装及权限",
        )
    })?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| DomainError::new(ErrorKind::GitQueryFailed, "Git 输出不可用"))?
        .take(limit + 1);
    tokio::time::timeout(Duration::from_secs(8), async {
        let mut bytes = vec![];
        stdout
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| DomainError::new(ErrorKind::GitQueryFailed, "Git 输出读取失败"))?;
        let truncated = bytes.len() as u64 > limit;
        if truncated {
            let _ = child.kill().await;
            bytes.truncate(limit as usize);
        }
        let success = child
            .wait()
            .await
            .map_err(|_| DomainError::new(ErrorKind::GitQueryFailed, "Git 查询未完成"))?
            .success();
        Ok((bytes, truncated, success))
    })
    .await
    .map_err(|_| DomainError::new(ErrorKind::GitTimeout, "Git 查询超时"))?
}
pub async fn changes(workspace: &str) -> Result<Value, DomainError> {
    let root = PathBuf::from(workspace)
        .canonicalize()
        .map_err(workspace_error)?;
    let (git_root, _, is_git) = git(&root, &["rev-parse", "--show-toplevel"], 8192).await?;
    if !is_git {
        let metadata_present =
            root.ancestors().any(
                |parent| match std::fs::symlink_metadata(parent.join(".git")) {
                    Ok(_) => true,
                    Err(error) => error.kind() != std::io::ErrorKind::NotFound,
                },
            );
        if metadata_present {
            return Err(DomainError::new(
                ErrorKind::GitQueryFailed,
                "无法确认 Git 工作树状态，请检查仓库与访问权限",
            ));
        }
        return Ok(json!({"isGit":false,"files":[],"notice":"工作区不是 Git 工作树"}));
    }
    let git_root = PathBuf::from(String::from_utf8_lossy(&git_root).trim());
    let (branch, branch_truncated, branch_known) =
        git(&root, &["symbolic-ref", "--short", "HEAD"], 4096).await?;
    let (bytes, truncated, success) = git(
        &root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
        1024 * 1024,
    )
    .await?;
    if !success && !truncated {
        return Err(DomainError::new(
            ErrorKind::GitQueryFailed,
            "无法读取 Git 状态，未将查询失败视为空变更",
        ));
    }
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
        files.push(json!({"path":relative.to_string_lossy(),"status":status,"staged":record[0]!=b' '&&record[0]!=b'?',"unstaged":record[1]!=b' '&&record[1]!=b'?',"untracked":status=="??"}));
    }
    Ok(
        json!({"isGit":true,"branch":if branch_known&&!branch_truncated{String::from_utf8_lossy(&branch).trim().to_owned()}else{String::new()},"files":files,"truncated":truncated,"collectedAt":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),"notice":"这是工作区当前变更，可能包含用户和其他工具的修改。"}),
    )
}
pub async fn diff(workspace: &str, path: &str, staged: bool) -> Result<Value, DomainError> {
    if path.is_empty() {
        return Err(invalid("请选择要查看差异的文件"));
    }
    let root = PathBuf::from(workspace)
        .canonicalize()
        .map_err(workspace_error)?;
    resolve(&root, path, true)?;
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    let (bytes, truncated, success) = git(&root, &args, 256 * 1024).await?;
    if !success && !truncated {
        return Err(DomainError::new(
            ErrorKind::GitQueryFailed,
            "无法读取 Git 差异",
        ));
    }
    Ok(
        json!({"path":path,"staged":staged,"text":String::from_utf8_lossy(&bytes),"truncated":truncated}),
    )
}
pub async fn read(workspace: &str, path: &str) -> Result<Value, DomainError> {
    resolve(Path::new(workspace), path, false)?;
    let root = workspace.to_owned();
    let path = path.to_owned();
    tokio::task::spawn_blocking(move||{
        use std::io::Read;
        let directory=cap_std::fs::Dir::open_ambient_dir(&root,cap_std::ambient_authority()).map_err(workspace_error)?;
        if !directory.metadata(&path).map_err(resource_error)?.is_file(){return Err(invalid("请选择普通文件"));}
        let mut options=cap_std::fs::OpenOptions::new();options.read(true);
        #[cfg(unix)]{use cap_std::fs::OpenOptionsExt;options.custom_flags(rustix::fs::OFlags::NONBLOCK.bits() as i32);}
        let file=directory.open_with(&path,&options).map_err(resource_error)?;
        let metadata=file.metadata().map_err(resource_error)?;if !metadata.is_file(){return Err(invalid("请选择普通文件"));}
        let mut bytes=vec![];file.take(256*1024+1).read_to_end(&mut bytes).map_err(resource_error)?;
        let truncated=bytes.len()>256*1024;bytes.truncate(256*1024);
        // A bounded preview may end inside a valid multibyte code point.
        let invalid_utf8=match std::str::from_utf8(&bytes){
            Ok(_)=>false,
            Err(error) if truncated && error.error_len().is_none()=>{let boundary=error.valid_up_to();bytes.truncate(boundary);false},
            Err(_)=>true,
        };
        let binary=bytes.contains(&0)||invalid_utf8;
        Ok(json!({"path":path,"size":metadata.len(),"binary":binary,"truncated":truncated,"text":if binary{String::new()}else{String::from_utf8_lossy(&bytes).into_owned()}}))
    }).await.map_err(|_|DomainError::new(ErrorKind::Internal,"文件读取任务未完成"))?
}
pub async fn tree(workspace: &str, path: &str) -> Result<Value, DomainError> {
    resolve(Path::new(workspace), path, false)?;
    let root = workspace.to_owned();
    let path = path.to_owned();
    tokio::task::spawn_blocking(move||{
        let directory=cap_std::fs::Dir::open_ambient_dir(&root,cap_std::ambient_authority()).map_err(workspace_error)?;
        let mut entries=vec![];
        for entry in directory.read_dir(&path).map_err(resource_error)? {
            let entry=entry.map_err(resource_error)?;let name=entry.file_name().to_string_lossy().into_owned();if name==".git"{continue;}
            let kind=entry.file_type().map_err(resource_error)?;
            entries.push(json!({"name":name,"path":Path::new(&path).join(&name).to_string_lossy(),"kind":if kind.is_symlink(){"symlink"}else if kind.is_dir(){"directory"}else{"file"}}));if entries.len()==300{break;}
        }
        entries.sort_by(|a,b|a["name"].as_str().cmp(&b["name"].as_str()));Ok(json!({"path":path,"truncated":entries.len()==300,"entries":entries}))
    }).await.map_err(|_|DomainError::new(ErrorKind::Internal,"目录读取任务未完成"))?
}

/// References are workspace-relative files, or directories marked by a trailing slash.
/// Directory context contains names only; it never recursively reads file contents.
pub async fn reference(workspace: &str, path: &str) -> Result<String, String> {
    if path.ends_with('/') {
        let listing = tree(workspace, path)
            .await
            .map_err(|error| error.to_string())?;
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
    let content = read(workspace, path)
        .await
        .map_err(|error| error.to_string())?;
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
