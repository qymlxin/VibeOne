use schemars::{JsonSchema, schema_for};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Last durably confirmed intent; the live listener is reported separately.
#[derive(Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct RemoteConfiguration {
    pub enabled: bool,
    pub ip: Option<String>,
    pub port: Option<u16>,
}
#[derive(Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteClaimSummary {
    pub id: String,
    pub name: String,
    pub expires_at: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RemoteDeviceRole {
    Viewer,
    Approver,
    Operator,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RemoteDeviceStatus {
    Active,
    Expired,
    Revoked,
    Invalid,
}
#[derive(Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDeviceSummary {
    pub id: Option<String>,
    pub name: String,
    pub role: Option<RemoteDeviceRole>,
    pub workspaces: Vec<String>,
    pub created_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub revoked: bool,
    pub status: RemoteDeviceStatus,
}
#[derive(Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatusResponse {
    pub url: Option<String>,
    pub qr: Option<String>,
    pub configuration: RemoteConfiguration,
    pub devices: Vec<RemoteDeviceSummary>,
    pub claims: Vec<RemoteClaimSummary>,
    pub suggested_ip: Option<String>,
    pub certificate_path: String,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProfileCatalogResponse {
    pub profiles: Vec<ProfileSummary>,
    pub issues: Vec<ProfileIssue>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProbeRequest {
    #[serde(default)]
    pub profile_id: Option<String>,
}
#[derive(Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProbeResponse {
    pub provider: String,
    pub profile_id: Option<String>,
    pub profile_revision: Option<u64>,
    pub state: String,
    pub name: Option<String>,
    pub version: Option<String>,
    pub protocol_version: Option<u64>,
    pub capabilities: serde_json::Value,
    pub authentication: String,
    pub authentication_command: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct CreateSessionRequest {
    pub key: Option<String>,
    pub provider: String,
    #[serde(default)]
    pub workspace: String,
    #[serde(rename = "profileId")]
    pub profile_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct SubmitMessageRequest {
    pub text: String,
    pub key: Option<String>,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueueRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub withdraw: Option<String>,
    #[serde(default)]
    pub pause: bool,
    #[serde(default)]
    pub resume: bool,
    #[serde(default)]
    pub fresh_context: bool,
}
#[derive(Clone, Serialize, JsonSchema)]
pub struct QueueResponse {
    pub updated: bool,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct CaptureArtifactRequest {
    pub path: String,
    pub key: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct ArtifactContent {
    pub path: String,
    pub size: u64,
    pub binary: bool,
    pub truncated: bool,
    pub text: String,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    pub id: String,
    pub session_id: String,
    pub run_id: Option<String>,
    pub path: String,
    pub content: ArtifactContent,
    pub created_at: u64,
    pub source: String,
}

#[derive(Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub key: Option<String>,
    pub run_id: Option<String>,
}
#[derive(Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancelResponse {
    pub cancel_requested: bool,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct UpdateSessionRequest {
    pub title: Option<String>,
    pub archived: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct WorkspaceImportRequest {
    pub path: String,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct ApprovalDecisionRequest {
    pub option: String,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct ConfigureAgentRequest {
    pub id: String,
    #[serde(default)]
    pub value: Value,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct SessionUpdateResponse {
    pub updated: bool,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct DecisionSubmittedResponse {
    pub submitted: bool,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResumeContextResponse {
    pub resume_on_next_run: bool,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentUploadRequest {
    pub name: String,
    pub mime_type: String,
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct PluginTicketRequest {
    pub ticket: String,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct CreateSessionResponse {
    pub id: String,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PluginLifecycleAction {
    Inspect,
    Prepare,
    Commit,
    Discard,
    Disable,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PluginLifecycleRequest {
    pub key: String,
    pub action: PluginLifecycleAction,
    pub input: Value,
}
#[derive(Clone, Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginOperationReceipt {
    pub operation_id: String,
    pub state: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct PluginOperationError {
    pub code: String,
    pub message: String,
}
#[derive(Clone, Debug, Default, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginOperationSummary {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<PluginOperationError>,
}
#[derive(Clone, Debug, Serialize, JsonSchema)]
pub struct PluginOperationRecord {
    #[serde(flatten)]
    pub summary: PluginOperationSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
}
#[derive(Clone, Serialize, JsonSchema)]
pub struct PluginOperationListResponse {
    pub operations: Vec<PluginOperationSummary>,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubmitMessageReceipt {
    pub operation_id: String,
    pub queued: bool,
    pub duplicate: bool,
}
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HttpErrorResponse {
    pub code: String,
    pub error: String,
    pub status: u16,
    pub request_id: String,
}

#[derive(Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(flatten)]
    pub extensions: std::collections::BTreeMap<String, Value>,
}
impl ProfileDetails {
    pub(crate) fn redact(&mut self) {
        self.command = None;
        self.args = None;
        self.extensions.clear();
    }
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProfileView {
    pub id: String,
    pub name: String,
    pub provider: String,
    #[serde(flatten)]
    pub details: ProfileDetails,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct PinnedProfile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(flatten)]
    pub details: ProfileDetails,
}
impl From<ProfileView> for PinnedProfile {
    fn from(value: ProfileView) -> Self {
        Self {
            id: Some(value.id),
            name: Some(value.name),
            provider: Some(value.provider),
            details: value.details,
        }
    }
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileIssue {
    pub id: String,
    pub error: String,
    pub revision: Option<u64>,
    pub record_hash: String,
}

#[derive(Clone, Serialize, JsonSchema)]
pub struct WorkspaceView {
    pub id: String,
    pub path: String,
    pub name: String,
}
impl From<&vibeone_storage::Workspace> for WorkspaceView {
    fn from(value: &vibeone_storage::Workspace) -> Self {
        Self {
            id: value.id.clone(),
            path: value.path.clone(),
            name: value.name.clone(),
        }
    }
}

#[derive(Clone, Serialize, JsonSchema)]
pub struct DeviceView {
    pub id: Option<String>,
    pub role: Option<String>,
}

#[derive(Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMetadata {
    pub api_version: u32,
    pub features: Vec<String>,
    pub protocol_version: u32,
    pub sdk_version: String,
    pub persistent: bool,
    pub storage_error: Option<String>,
    pub revision: u64,
    pub example_plugin_path: Option<std::path::PathBuf>,
    pub plugin_events: Vec<Value>,
    pub operations: Vec<PluginOperationSummary>,
    pub plugins: Vec<Value>,
    pub notifications: Vec<Value>,
    pub profiles: Vec<ProfileView>,
    pub profile_issues: Vec<ProfileIssue>,
    pub providers: Vec<crate::providers::Provider>,
    pub workspaces: Vec<WorkspaceView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<DeviceView>,
}

#[derive(Clone, Serialize, JsonSchema)]
pub struct SnapshotResponse {
    #[serde(flatten)]
    pub metadata: SnapshotMetadata,
    pub sessions: Vec<crate::projection::SessionView>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
    #[serde(flatten)]
    pub extensions: std::collections::BTreeMap<String, Value>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingRequest {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<PermissionOption>>,
    #[serde(flatten)]
    pub payload: std::collections::BTreeMap<String, Value>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DecisionRecord {
    pub id: String,
    pub request_id: String,
    pub delivery: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(flatten)]
    pub extensions: std::collections::BTreeMap<String, Value>,
}

fn legacy_array<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<Vec<T>>::deserialize(deserializer).map(Option::unwrap_or_default)
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    #[serde(default)]
    pub text: String,
    pub status: String,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default, deserialize_with = "legacy_array")]
    #[schemars(with = "Vec<String>")]
    pub files: Vec<String>,
    #[serde(default, deserialize_with = "legacy_array")]
    #[schemars(with = "Vec<String>")]
    pub attachment_ids: Vec<String>,
    #[serde(default, deserialize_with = "legacy_array")]
    #[schemars(with = "Vec<Value>")]
    pub attachments: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(flatten)]
    pub extensions: std::collections::BTreeMap<String, Value>,
}

// An omitted optional command field differs from an explicitly invalid null.
fn provided<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProfileRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(
        default,
        rename = "recordHash",
        skip_serializing_if = "Option::is_none",
        deserialize_with = "provided"
    )]
    #[schemars(with = "String")]
    pub record_hash: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "provided"
    )]
    #[schemars(with = "String")]
    pub id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "provided"
    )]
    #[schemars(with = "u64")]
    pub revision: Option<u64>,
    #[serde(default)]
    pub remove: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "provided"
    )]
    #[schemars(with = "String")]
    pub name: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "provided"
    )]
    #[schemars(with = "String")]
    pub provider: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "provided"
    )]
    #[schemars(with = "String")]
    pub command: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "provided"
    )]
    #[schemars(with = "Vec<String>")]
    pub args: Option<Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct ProfileRecord {
    pub id: String,
    pub revision: u64,
    pub name: String,
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum ProfileResponse {
    Saved(ProfileRecord),
    Removed { removed: bool },
}

/// Generated from the same types used by the HTTP extractors/serializers.
pub fn schemas() -> Value {
    Value::Object(
        [
            (
                "PluginLifecycleRequest".into(),
                json!(schema_for!(PluginLifecycleRequest)),
            ),
            (
                "PluginOperationReceipt".into(),
                json!(schema_for!(PluginOperationReceipt)),
            ),
            (
                "PluginOperationSummary".into(),
                json!(schema_for!(PluginOperationSummary)),
            ),
            (
                "PluginOperationRecord".into(),
                json!(schema_for!(PluginOperationRecord)),
            ),
            (
                "PluginOperationListResponse".into(),
                json!(schema_for!(PluginOperationListResponse)),
            ),
            (
                "RemoteDeviceSummary".into(),
                json!(schema_for!(RemoteDeviceSummary)),
            ),
            (
                "RemoteConfiguration".into(),
                json!(schema_for!(RemoteConfiguration)),
            ),
            (
                "RemoteStatusResponse".into(),
                json!(schema_for!(RemoteStatusResponse)),
            ),
            (
                "CreateSessionRequest".into(),
                json!(schema_for!(CreateSessionRequest)),
            ),
            (
                "SubmitMessageRequest".into(),
                json!(schema_for!(SubmitMessageRequest)),
            ),
            ("QueueRequest".into(), json!(schema_for!(QueueRequest))),
            ("QueueResponse".into(), json!(schema_for!(QueueResponse))),
            (
                "CaptureArtifactRequest".into(),
                json!(schema_for!(CaptureArtifactRequest)),
            ),
            ("ArtifactRecord".into(), json!(schema_for!(ArtifactRecord))),
            ("CancelRequest".into(), json!(schema_for!(CancelRequest))),
            ("CancelResponse".into(), json!(schema_for!(CancelResponse))),
            (
                "UpdateSessionRequest".into(),
                json!(schema_for!(UpdateSessionRequest)),
            ),
            (
                "WorkspaceImportRequest".into(),
                json!(schema_for!(WorkspaceImportRequest)),
            ),
            (
                "ApprovalDecisionRequest".into(),
                json!(schema_for!(ApprovalDecisionRequest)),
            ),
            (
                "ConfigureAgentRequest".into(),
                json!(schema_for!(ConfigureAgentRequest)),
            ),
            (
                "SessionUpdateResponse".into(),
                json!(schema_for!(SessionUpdateResponse)),
            ),
            (
                "DecisionSubmittedResponse".into(),
                json!(schema_for!(DecisionSubmittedResponse)),
            ),
            (
                "ResumeContextResponse".into(),
                json!(schema_for!(ResumeContextResponse)),
            ),
            (
                "AttachmentUploadRequest".into(),
                json!(schema_for!(AttachmentUploadRequest)),
            ),
            (
                "PluginTicketRequest".into(),
                json!(schema_for!(PluginTicketRequest)),
            ),
            (
                "CreateSessionResponse".into(),
                json!(schema_for!(CreateSessionResponse)),
            ),
            (
                "SubmitMessageReceipt".into(),
                json!(schema_for!(SubmitMessageReceipt)),
            ),
            (
                "HttpErrorResponse".into(),
                json!(schema_for!(HttpErrorResponse)),
            ),
            (
                "SnapshotResponse".into(),
                json!(schema_for!(SnapshotResponse)),
            ),
            (
                "SnapshotMetadata".into(),
                json!(schema_for!(SnapshotMetadata)),
            ),
            ("PendingRequest".into(), json!(schema_for!(PendingRequest))),
            ("DecisionRecord".into(), json!(schema_for!(DecisionRecord))),
            ("RunRecord".into(), json!(schema_for!(RunRecord))),
            (
                "SessionView".into(),
                json!(schema_for!(crate::projection::SessionView)),
            ),
            ("ProfileView".into(), json!(schema_for!(ProfileView))),
            ("ProfileSummary".into(), json!(schema_for!(ProfileSummary))),
            (
                "ProfileCatalogResponse".into(),
                json!(schema_for!(ProfileCatalogResponse)),
            ),
            ("PinnedProfile".into(), json!(schema_for!(PinnedProfile))),
            ("ProfileIssue".into(), json!(schema_for!(ProfileIssue))),
            ("ProfileRequest".into(), json!(schema_for!(ProfileRequest))),
            ("ProfileRecord".into(), json!(schema_for!(ProfileRecord))),
            (
                "ProfileResponse".into(),
                json!(schema_for!(ProfileResponse)),
            ),
            (
                "ProviderProbeRequest".into(),
                json!(schema_for!(ProviderProbeRequest)),
            ),
            (
                "ProviderProbeResponse".into(),
                json!(schema_for!(ProviderProbeResponse)),
            ),
        ]
        .into_iter()
        .collect(),
    )
}

#[cfg(test)]
mod tests {

    #[test]
    fn agent_configuration_request_schema_preserves_dynamic_values_and_legacy_null() {
        let schema = serde_json::to_value(schema_for!(ConfigureAgentRequest)).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        for raw in [
            json!({"id":"mode"}),
            json!({"id":"mode","value":null}),
            json!({"id":"future","value":{"items":[false,1,"x",null]}}),
        ] {
            assert!(validator.is_valid(&raw));
            let decoded: ConfigureAgentRequest = serde_json::from_value(raw.clone()).unwrap();
            assert_eq!(decoded.value, raw["value"]);
        }
        for raw in [
            json!({"value":"safe"}),
            json!({"id":null}),
            json!({"id":42}),
        ] {
            assert!(!validator.is_valid(&raw));
            assert!(serde_json::from_value::<ConfigureAgentRequest>(raw).is_err());
        }
    }
    use super::*;
    #[test]
    fn session_wire_schema_preserves_legacy_runs_extensions_and_private_flags() {
        let raw = json!({"id":"legacy", "title":"Legacy", "workspace":"/legacy", "provider":"demo", "status":"idle", "messages":[], "tools":[], "approvals":[], "error":null, "stopReason":null,
            "runs":[{"id":"run","text":"task","status":"completed","files":null,"attachments":null,"attachmentIds":null,"futureField":{"keep":true}}], "queue":null});
        let mut view: crate::projection::SessionView = serde_json::from_value(raw).unwrap();
        view.active = true;
        view.observed_active = true;
        let wire = serde_json::to_value(&view).unwrap();
        assert!(wire.get("active").is_none());
        assert!(wire.get("observedActive").is_none());
        assert_eq!(wire["queue"], json!([]));
        assert_eq!(wire["runs"][0]["futureField"], json!({"keep":true}));
        assert_eq!(wire["runs"][0]["files"], json!([]));
        assert!(wire["runs"][0].get("createdAt").is_none());
        let schema = serde_json::to_value(schema_for!(crate::projection::SessionView)).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        assert!(validator.is_valid(&wire));
        let mut invalid = wire.clone();
        invalid["runs"][0]["files"] = json!([1]);
        assert!(!validator.is_valid(&invalid));
        invalid = wire;
        invalid["queue"] = json!("invalid queue");
        assert!(!validator.is_valid(&invalid));
        let roundtrip: crate::projection::SessionView =
            serde_json::from_value(serde_json::to_value(&view).unwrap()).unwrap();
        assert_eq!(
            roundtrip.runs[0].extensions["futureField"],
            json!({"keep":true})
        );
    }

    #[test]
    fn pending_identity_options_dynamic_input_and_decision_content_roundtrip() {
        let raw = json!({"id":"approval","runId":"run","createdAt":10,"expiresAt":20,"options":[{"optionId":"allow","name":"允许","kind":"allow_once","future":true}],"toolCall":{"title":"Read"},"futureRoot":{"keep":true}});
        let pending: PendingRequest = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(pending.id, "approval");
        assert_eq!(pending.options.as_ref().unwrap()[0].option_id, "allow");
        assert_eq!(serde_json::to_value(pending).unwrap(), raw);
        let input = json!({"id":"input","mode":"form","requestedSchema":{"type":"object","properties":{"confirmed":{"type":"boolean"}}}});
        let request: PendingRequest = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), input);
        let decision = json!({"id":"decision","requestId":"input","delivery":"pending","answer":{"action":"accept","content":{"confirmed":false,"count":0}},"future":"keep"});
        let record: DecisionRecord = serde_json::from_value(decision.clone()).unwrap();
        assert_eq!(serde_json::to_value(record).unwrap(), decision);
        let schema = serde_json::to_value(schema_for!(PendingRequest)).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        assert!(validator.is_valid(&raw));
        assert!(validator.is_valid(&input));
        let mut invalid = raw;
        invalid["options"][0]["optionId"] = json!(42);
        assert!(!validator.is_valid(&invalid));
        assert!(serde_json::from_value::<PendingRequest>(invalid).is_err());
    }

    #[test]
    fn profile_optional_fields_preserve_absence_and_reject_explicit_null() {
        let schema = serde_json::to_value(schema_for!(ProfileRequest)).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        for (value, accepted) in [
            (json!({"name":"demo","provider":"demo"}), true),
            (json!({"id":"one","revision":2,"remove":true}), true),
            (json!({"revision":null}), false),
            (json!({"args":null}), false),
            (json!({"args":[1]}), false),
            (json!({"revision":-1}), false),
        ] {
            assert_eq!(validator.is_valid(&value), accepted, "{value}");
            assert_eq!(
                serde_json::from_value::<ProfileRequest>(value).is_ok(),
                accepted
            );
        }
        let request: ProfileRequest =
            serde_json::from_value(json!({"name":"demo","provider":"demo"})).unwrap();
        assert!(
            serde_json::to_value(request)
                .unwrap()
                .get("revision")
                .is_none()
        );
    }

    #[test]
    fn exported_schemas_match_actual_missing_and_null_deserialization_rules() {
        let create = serde_json::to_value(schema_for!(CreateSessionRequest)).unwrap();
        let validator = jsonschema::validator_for(&create).unwrap();
        for (value, accepted) in [
            (json!({"provider":"demo"}), true),
            (json!({"provider":"demo","profileId":null}), true),
            (json!({"provider":"demo","workspace":null}), false),
            (json!({"workspace":"/project"}), false),
        ] {
            assert_eq!(validator.is_valid(&value), accepted);
            assert_eq!(
                serde_json::from_value::<CreateSessionRequest>(value).is_ok(),
                accepted
            );
        }
        let request: CreateSessionRequest =
            serde_json::from_value(json!({"provider":"demo"})).unwrap();
        assert_eq!(request.workspace, "");
        assert!(request.profile_id.is_none());
        let schema = serde_json::to_value(schema_for!(SubmitMessageRequest)).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        for (value, accepted) in [
            (json!({"text":"task"}), true),
            (json!({"text":"task","files":null}), false),
            (json!({"text":42}), false),
        ] {
            assert_eq!(validator.is_valid(&value), accepted);
            assert_eq!(
                serde_json::from_value::<SubmitMessageRequest>(value).is_ok(),
                accepted
            );
        }
    }
}
