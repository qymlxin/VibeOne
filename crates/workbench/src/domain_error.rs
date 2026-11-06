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
    AttentionExpired,
    DecisionConflict,
    InvalidDecision,
    InvalidAnswer,
    UpstreamInvalid,
    AgentDisconnected,
    ConfigurationUnsupported,
    InvalidConfiguration,
    ConfigurationFailed,
    SessionBusy,
    ProfileNotFound,
    ProfileInvalid,
    ProviderNotFound,
    SessionLimit,
    WorkspaceUnavailable,
    AttachmentTooLarge,
    AttachmentNotFound,
    AttachmentLimit,
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
            Self::AttentionExpired => "ATTENTION_EXPIRED",
            Self::DecisionConflict => "DECISION_CONFLICT",
            Self::InvalidDecision => "INVALID_DECISION",
            Self::InvalidAnswer => "INVALID_ANSWER",
            Self::UpstreamInvalid => "UPSTREAM_INVALID",
            Self::AgentDisconnected => "AGENT_DISCONNECTED",
            Self::ConfigurationUnsupported => "CONFIGURATION_UNSUPPORTED",
            Self::InvalidConfiguration => "INVALID_CONFIGURATION",
            Self::ConfigurationFailed => "CONFIGURATION_FAILED",
            Self::SessionBusy => "SESSION_BUSY",
            Self::ProfileNotFound => "PROFILE_NOT_FOUND",
            Self::ProfileInvalid => "PROFILE_INVALID",
            Self::ProviderNotFound => "PROVIDER_NOT_FOUND",
            Self::SessionLimit => "SESSION_LIMIT_REACHED",
            Self::WorkspaceUnavailable => "WORKSPACE_UNAVAILABLE",
            Self::AttachmentTooLarge => "ATTACHMENT_TOO_LARGE",
            Self::AttachmentNotFound => "ATTACHMENT_NOT_FOUND",
            Self::AttachmentLimit => "ATTACHMENT_LIMIT_REACHED",
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
            Self::InvalidInput
            | Self::InvalidReference
            | Self::InvalidAttachment
            | Self::InvalidDecision
            | Self::InvalidAnswer
            | Self::ConfigurationUnsupported
            | Self::InvalidConfiguration => 400,
            Self::ProfileNotFound
            | Self::WorkspaceNotFound
            | Self::SessionNotFound
            | Self::ProviderNotFound
            | Self::AttachmentNotFound => 404,
            Self::AttachmentTooLarge => 413,
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
            Self::ProfileInvalid | Self::SessionLimit | Self::AttachmentLimit => 409,
            Self::AttentionExpired
            | Self::DecisionConflict
            | Self::AgentDisconnected
            | Self::SessionBusy => 409,
            Self::StorageUnavailable
            | Self::HostUnavailable
            | Self::ProviderUnavailable
            | Self::WorkspaceUnavailable => 503,
            Self::DeliveryUncertain | Self::UpstreamInvalid | Self::ConfigurationFailed => 502,
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
