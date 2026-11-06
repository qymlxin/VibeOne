//! Business failures carry identity independently from their human-readable copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ErrorKind {
    InvalidInput,
    ProfileNotFound,
    ProfileConflict,
    ProfileLimit,
    WorkspaceNotFound,
    WorkspaceForbidden,
    StorageUnavailable,
    HostUnavailable,
    Internal,
}
impl ErrorKind {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_INPUT",
            Self::ProfileNotFound => "PROFILE_NOT_FOUND",
            Self::ProfileConflict => "PROFILE_CONFLICT",
            Self::ProfileLimit => "PROFILE_LIMIT_REACHED",
            Self::WorkspaceNotFound => "WORKSPACE_NOT_FOUND",
            Self::WorkspaceForbidden => "WORKSPACE_FORBIDDEN",
            Self::StorageUnavailable => "STORAGE_UNAVAILABLE",
            Self::HostUnavailable => "HOST_UNAVAILABLE",
            Self::Internal => "INTERNAL_ERROR",
        }
    }
    pub(crate) fn status(self) -> u16 {
        match self {
            Self::InvalidInput => 400,
            Self::ProfileNotFound | Self::WorkspaceNotFound => 404,
            Self::WorkspaceForbidden => 403,
            Self::ProfileConflict | Self::ProfileLimit => 409,
            Self::StorageUnavailable | Self::HostUnavailable => 503,
            Self::Internal => 500,
        }
    }
}
#[derive(Debug)]
pub(crate) struct DomainError {
    pub(crate) kind: ErrorKind,
    pub(crate) message: String,
}
impl DomainError {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
    pub(crate) fn storage() -> Self {
        Self::new(
            ErrorKind::StorageUnavailable,
            "存储暂不可用，请检查诊断后重试",
        )
    }
}
impl std::fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}
impl std::error::Error for DomainError {}
