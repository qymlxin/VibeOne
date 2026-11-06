use schemars::{JsonSchema, schema_for};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

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
        "ProfileRequest":schema_for!(ProfileRequest),
        "ProfileRecord":schema_for!(ProfileRecord),
        "ProfileResponse":schema_for!(ProfileResponse)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
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
