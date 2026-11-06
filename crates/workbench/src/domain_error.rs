//! Business failures carry identity independently from their human-readable copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ErrorKind {
    RemoteAlreadyRunning,
    RemoteAddressForbidden,
    RemoteAddressInUse,
    RemoteUnavailable,
    RemoteTlsInvalid,
    RemoteTlsUnavailable,
    RemoteWebUnavailable,
    RemoteDisabled,
    PairingInvalid,
    PairingExpired,
    PairingConflict,
    PairingRateLimited,
    DeviceNotFound,
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
    PluginTrustRequired,
    PluginCandidateLimit,
    PluginLimit,
    PluginManifestChanged,
    PluginCandidateExpired,
    PluginGenerationConflict,
    PluginConfigurationInvalid,
    PluginPermissionDenied,
    PluginActivationFailed,
    PluginOperationFailed,
    PluginTimeout,
    OperationLimit,
    OperationNotFound,
    PluginInvalid,
    PluginIncompatible,
    PluginUnavailable,
    PluginResourceNotFound,
    PluginResourceTooLarge,
    PluginNotFound,
    PluginDisabled,
    ResourceForbidden,
    ResourceNotFound,
    ResourceUnavailable,
    GitUnavailable,
    GitQueryFailed,
    GitTimeout,
    ArtifactUnsupported,
    ArtifactLimit,
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
            Self::RemoteAlreadyRunning => "REMOTE_ALREADY_RUNNING",
            Self::RemoteAddressForbidden => "REMOTE_ADDRESS_FORBIDDEN",
            Self::RemoteAddressInUse => "REMOTE_ADDRESS_IN_USE",
            Self::RemoteUnavailable => "REMOTE_UNAVAILABLE",
            Self::RemoteTlsInvalid => "REMOTE_TLS_INVALID",
            Self::RemoteTlsUnavailable => "REMOTE_TLS_UNAVAILABLE",
            Self::RemoteWebUnavailable => "REMOTE_WEB_UNAVAILABLE",
            Self::RemoteDisabled => "REMOTE_DISABLED",
            Self::PairingInvalid => "PAIRING_INVALID",
            Self::PairingExpired => "PAIRING_EXPIRED",
            Self::PairingConflict => "PAIRING_CONFLICT",
            Self::PairingRateLimited => "PAIRING_RATE_LIMITED",
            Self::DeviceNotFound => "DEVICE_NOT_FOUND",
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
            Self::PluginTrustRequired => "PLUGIN_TRUST_REQUIRED",
            Self::PluginCandidateLimit => "PLUGIN_CANDIDATE_LIMIT_REACHED",
            Self::PluginLimit => "PLUGIN_LIMIT_REACHED",
            Self::PluginManifestChanged => "PLUGIN_MANIFEST_CHANGED",
            Self::PluginCandidateExpired => "PLUGIN_CANDIDATE_EXPIRED",
            Self::PluginGenerationConflict => "PLUGIN_GENERATION_CONFLICT",
            Self::PluginConfigurationInvalid => "PLUGIN_CONFIGURATION_INVALID",
            Self::PluginPermissionDenied => "PLUGIN_PERMISSION_DENIED",
            Self::PluginActivationFailed => "PLUGIN_ACTIVATION_FAILED",
            Self::PluginOperationFailed => "PLUGIN_OPERATION_FAILED",
            Self::PluginTimeout => "PLUGIN_TIMEOUT",
            Self::OperationLimit => "OPERATION_LIMIT_REACHED",
            Self::OperationNotFound => "OPERATION_NOT_FOUND",
            Self::PluginInvalid => "PLUGIN_INVALID",
            Self::PluginIncompatible => "PLUGIN_INCOMPATIBLE",
            Self::PluginUnavailable => "PLUGIN_UNAVAILABLE",
            Self::PluginResourceNotFound => "PLUGIN_RESOURCE_NOT_FOUND",
            Self::PluginResourceTooLarge => "PLUGIN_RESOURCE_TOO_LARGE",
            Self::PluginNotFound => "PLUGIN_NOT_FOUND",
            Self::PluginDisabled => "PLUGIN_DISABLED",
            Self::ResourceForbidden => "RESOURCE_FORBIDDEN",
            Self::ResourceNotFound => "RESOURCE_NOT_FOUND",
            Self::ResourceUnavailable => "RESOURCE_UNAVAILABLE",
            Self::GitUnavailable => "GIT_UNAVAILABLE",
            Self::GitQueryFailed => "GIT_QUERY_FAILED",
            Self::GitTimeout => "GIT_TIMEOUT",
            Self::ArtifactUnsupported => "ARTIFACT_UNSUPPORTED",
            Self::ArtifactLimit => "ARTIFACT_LIMIT_REACHED",
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
            Self::RemoteAlreadyRunning => 409,
            Self::RemoteAddressForbidden => 403,
            Self::RemoteAddressInUse => 409,
            Self::RemoteUnavailable => 503,
            Self::RemoteTlsInvalid => 409,
            Self::RemoteTlsUnavailable => 503,
            Self::RemoteWebUnavailable => 503,
            Self::RemoteDisabled => 409,
            Self::PairingInvalid => 403,
            Self::PairingExpired => 409,
            Self::PairingConflict => 409,
            Self::PairingRateLimited => 429,
            Self::DeviceNotFound => 404,
            Self::PluginTrustRequired => 403,
            Self::PluginCandidateLimit => 409,
            Self::PluginLimit => 409,
            Self::PluginManifestChanged => 409,
            Self::PluginCandidateExpired => 409,
            Self::PluginGenerationConflict => 409,
            Self::PluginConfigurationInvalid => 400,
            Self::PluginPermissionDenied => 403,
            Self::PluginActivationFailed => 502,
            Self::PluginOperationFailed => 502,
            Self::PluginTimeout => 504,
            Self::OperationLimit => 409,
            Self::OperationNotFound => 404,
            Self::InvalidInput
            | Self::InvalidReference
            | Self::InvalidAttachment
            | Self::InvalidDecision
            | Self::InvalidAnswer
            | Self::ConfigurationUnsupported
            | Self::InvalidConfiguration
            | Self::ArtifactUnsupported
            | Self::PluginInvalid
            | Self::PluginResourceTooLarge => 400,
            Self::ProfileNotFound
            | Self::WorkspaceNotFound
            | Self::SessionNotFound
            | Self::ProviderNotFound
            | Self::AttachmentNotFound
            | Self::ResourceNotFound
            | Self::PluginNotFound
            | Self::PluginResourceNotFound => 404,
            Self::AttachmentTooLarge => 413,
            Self::WorkspaceForbidden | Self::ResourceForbidden => 403,
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
            | Self::QueueConflict
            | Self::PluginIncompatible
            | Self::PluginDisabled => 409,
            Self::ProfileInvalid
            | Self::SessionLimit
            | Self::AttachmentLimit
            | Self::ArtifactLimit => 409,
            Self::AttentionExpired
            | Self::DecisionConflict
            | Self::AgentDisconnected
            | Self::SessionBusy => 409,
            Self::StorageUnavailable
            | Self::HostUnavailable
            | Self::ProviderUnavailable
            | Self::WorkspaceUnavailable
            | Self::ResourceUnavailable
            | Self::GitUnavailable
            | Self::PluginUnavailable => 503,
            Self::DeliveryUncertain
            | Self::UpstreamInvalid
            | Self::ConfigurationFailed
            | Self::GitQueryFailed => 502,
            Self::GitTimeout => 504,
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
