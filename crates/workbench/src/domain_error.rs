//! Business failures carry identity independently from their human-readable copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ErrorKind {
    InvalidInput,
    ProbeBusy,
    SessionNotFound,
    ContextConflict,
    SessionUnavailable,
    ConfigurationBusy,
    IdempotencyConflict,
    ProviderUnavailable,
    ProviderConflict,
    RunLimit,
    InvalidReference,
    InvalidAttachment,
    WorkspaceBusy,
    QueueConflict,
    DeliveryUncertain,
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
            Self::ProbeBusy => "PROBE_BUSY",
            Self::SessionNotFound => "SESSION_NOT_FOUND",
            Self::ContextConflict => "CONTEXT_CONFLICT",
            Self::SessionUnavailable => "SESSION_UNAVAILABLE",
            Self::ConfigurationBusy => "CONFIGURATION_BUSY",
            Self::IdempotencyConflict => "IDEMPOTENCY_CONFLICT",
            Self::ProviderUnavailable => "PROVIDER_UNAVAILABLE",
            Self::ProviderConflict => "PROVIDER_CONFLICT",
            Self::RunLimit => "RUN_LIMIT_REACHED",
            Self::InvalidReference => "INVALID_REFERENCE",
            Self::InvalidAttachment => "INVALID_ATTACHMENT",
            Self::WorkspaceBusy => "WORKSPACE_BUSY",
            Self::QueueConflict => "QUEUE_CONFLICT",
            Self::DeliveryUncertain => "DELIVERY_UNCERTAIN",
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
            Self::InvalidInput | Self::InvalidReference | Self::InvalidAttachment => 400,
            Self::ProfileNotFound | Self::WorkspaceNotFound | Self::SessionNotFound => 404,
            Self::WorkspaceForbidden => 403,
            Self::ProfileConflict
            | Self::ProfileLimit
            | Self::ProbeBusy
            | Self::ContextConflict
            | Self::SessionUnavailable
            | Self::ConfigurationBusy
            | Self::IdempotencyConflict
            | Self::ProviderConflict
            | Self::RunLimit
            | Self::WorkspaceBusy
            | Self::QueueConflict => 409,
            Self::StorageUnavailable | Self::HostUnavailable | Self::ProviderUnavailable => 503,
            Self::DeliveryUncertain => 502,
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
