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
    pub withdraw: Option<String>,
    #[serde(default)]
    pub pause: bool,
    #[serde(default)]
    pub resume: bool,
    #[serde(default)]
    pub fresh_context: bool,
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
    pub operations: Vec<Value>,
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

#[derive(Serialize, JsonSchema)]
#[serde(untagged)]
pub enum ProfileResponse {
    Saved(ProfileRecord),
    Removed { removed: bool },
}

/// Generated from the same types used by the HTTP extractors/serializers.
pub fn schemas() -> Value {
    json!({
        "RemoteDeviceSummary":schema_for!(RemoteDeviceSummary),
        "RemoteConfiguration":schema_for!(RemoteConfiguration),
        "RemoteStatusResponse":schema_for!(RemoteStatusResponse),
        "CreateSessionRequest":schema_for!(CreateSessionRequest),
        "SubmitMessageRequest":schema_for!(SubmitMessageRequest),
        "QueueRequest":schema_for!(QueueRequest),
        "UpdateSessionRequest":schema_for!(UpdateSessionRequest),
        "WorkspaceImportRequest":schema_for!(WorkspaceImportRequest),
        "ApprovalDecisionRequest":schema_for!(ApprovalDecisionRequest),
        "AttachmentUploadRequest":schema_for!(AttachmentUploadRequest),
        "PluginTicketRequest":schema_for!(PluginTicketRequest),
        "CreateSessionResponse":schema_for!(CreateSessionResponse),
        "SubmitMessageReceipt":schema_for!(SubmitMessageReceipt),
        "HttpErrorResponse":schema_for!(HttpErrorResponse),
        "SnapshotResponse":schema_for!(SnapshotResponse),
        "SnapshotMetadata":schema_for!(SnapshotMetadata),
        "PendingRequest":schema_for!(PendingRequest),
        "DecisionRecord":schema_for!(DecisionRecord),
        "RunRecord":schema_for!(RunRecord),
        "SessionView":schema_for!(crate::projection::SessionView),
        "ProfileView":schema_for!(ProfileView),
        "ProfileSummary":schema_for!(ProfileSummary),
        "ProfileCatalogResponse":schema_for!(ProfileCatalogResponse),
        "PinnedProfile":schema_for!(PinnedProfile),
        "ProfileIssue":schema_for!(ProfileIssue),
        "ProfileRequest":schema_for!(ProfileRequest),
        "ProfileRecord":schema_for!(ProfileRecord),
        "ProfileResponse":schema_for!(ProfileResponse),
        "ProviderProbeRequest":schema_for!(ProviderProbeRequest),
        "ProviderProbeResponse":schema_for!(ProviderProbeResponse)
    })
}

#[cfg(test)]
mod tests {
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
