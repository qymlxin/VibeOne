use crate::{
    domain_error::{DomainError, ErrorKind},
    files,
};
use std::{io::Read, path::Path};

pub(super) fn io_error(error: std::io::Error) -> DomainError {
    let kind = match error.kind() {
        std::io::ErrorKind::NotFound => ErrorKind::PluginResourceNotFound,
        std::io::ErrorKind::PermissionDenied => ErrorKind::ResourceForbidden,
        std::io::ErrorKind::InvalidInput
        | std::io::ErrorKind::NotADirectory
        | std::io::ErrorKind::IsADirectory => ErrorKind::PluginInvalid,
        _ => ErrorKind::PluginUnavailable,
    };
    DomainError::new(kind, "插件资源不可访问，请检查文件及权限")
}
fn open(root: &Path, relative: &str) -> Result<cap_std::fs::File, DomainError> {
    files::resolve(root, relative, false).map_err(|error| match error.kind {
        ErrorKind::WorkspaceNotFound | ErrorKind::ResourceNotFound => DomainError::new(
            ErrorKind::PluginResourceNotFound,
            "插件资源不存在，请重新检查目录",
        ),
        ErrorKind::ResourceForbidden | ErrorKind::WorkspaceForbidden => DomainError::new(
            ErrorKind::ResourceForbidden,
            "插件资源必须位于包目录内且允许读取",
        ),
        ErrorKind::InvalidInput => {
            DomainError::new(ErrorKind::PluginInvalid, "插件资源路径类型无效")
        }
        _ => DomainError::new(
            ErrorKind::PluginUnavailable,
            "插件资源不可访问，请重新检查目录",
        ),
    })?;
    let directory =
        cap_std::fs::Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(io_error)?;
    if !directory.metadata(relative).map_err(io_error)?.is_file() {
        return Err(DomainError::new(
            ErrorKind::PluginInvalid,
            "插件资源必须是普通文件",
        ));
    }
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(rustix::fs::OFlags::NONBLOCK.bits() as i32);
    }
    let file = directory.open_with(relative, &options).map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.is_file() {
        return Err(DomainError::new(
            ErrorKind::PluginInvalid,
            "插件资源必须是普通文件",
        ));
    }
    Ok(file)
}
pub(super) fn validate(root: &Path, relative: &str) -> Result<(), DomainError> {
    open(root, relative).map(|_| ())
}
pub(super) fn read(root: &Path, relative: &str, limit: u64) -> Result<Vec<u8>, DomainError> {
    let file = open(root, relative)?;
    let oversized = || {
        DomainError::new(
            ErrorKind::PluginResourceTooLarge,
            "插件资源超过此入口的读取上限",
        )
    };
    if file.metadata().map_err(io_error)?.len() > limit {
        return Err(oversized());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > limit {
        return Err(oversized());
    }
    Ok(bytes)
}

pub(super) fn text(root: &Path, relative: &str, limit: u64) -> Result<String, DomainError> {
    String::from_utf8(read(root, relative, limit)?).map_err(|_| {
        DomainError::new(
            ErrorKind::PluginInvalid,
            "插件 App 入口必须是 UTF-8 编码的单文件 ESM",
        )
    })
}
