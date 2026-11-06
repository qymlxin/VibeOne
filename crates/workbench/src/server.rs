use crate::contracts::*;
use crate::{providers::providers, state::Workbench};
mod errors;
mod remote;
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{fs::OpenOptions, path::PathBuf, sync::Arc, time::Duration};
use tokio::{net::TcpListener, sync::watch};
use tower_http::cors::CorsLayer;

#[derive(Clone)]
struct Server {
    workbench: Arc<Workbench>,
    token: String,
    stop: watch::Sender<bool>,
    remote: Arc<remote::Remote>,
    is_remote: bool,
}
type ApiResult<T = Value> = Result<Json<T>, (StatusCode, Json<Value>)>;
// Keep accepted state mutations alive when a browser closes the request connection.
async fn domain_command<T: Send + 'static>(
    future: impl std::future::Future<Output = Result<T, crate::domain_error::DomainError>>
    + Send
    + 'static,
) -> Result<T, crate::domain_error::DomainError> {
    tokio::spawn(future).await.map_err(|_| {
        crate::domain_error::DomainError::new(
            crate::domain_error::ErrorKind::Internal,
            "主机命令执行失败，请查看诊断",
        )
    })?
}
fn domain_fail(error: crate::domain_error::DomainError) -> (StatusCode, Json<Value>) {
    (
        StatusCode::from_u16(error.kind.status()).expect("domain status"),
        Json(json!({"code":error.kind.code(),"error":error.message})),
    )
}
const ORIGINS: [&str; 5] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://127.0.0.1:5174",
    "http://localhost:5174",
];

pub async fn serve(data_dir: PathBuf) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    std::fs::create_dir_all(&data_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&data_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(data_dir.join("host.lock"))?;
    lock.try_lock().map_err(|_| "此数据目录已有 Host 运行")?;
    std::fs::write(
        data_dir.join("demo-agent.mjs"),
        include_str!("../../agent-client/fixtures/demo-agent.mjs"),
    )?;
    let workbench = Workbench::open(&data_dir, providers(&data_dir)).await?;
    workbench.plugins.restore(&workbench).await;
    workbench.start_outbox();
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    let connection = json!({"url":format!("http://{address}"),"token":token,"protocolVersion":2,"pid":std::process::id()});
    let temp = data_dir.join("host.json.tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp)?;
    use std::io::Write;
    file.write_all(serde_json::to_string(&connection)?.as_bytes())?;
    file.sync_all()?;
    std::fs::rename(temp, data_dir.join("host.json"))?;
    let (stop, mut stopped) = watch::channel(false);
    let state = Server {
        workbench: workbench.clone(),
        token,
        stop: stop.clone(),
        remote: Arc::new(remote::Remote::new(data_dir.clone())),
        is_remote: false,
    };
    let config = remote::saved_configuration(&state);
    if config.enabled
        && let Some(ip) = config.ip.as_deref().and_then(|ip| ip.parse().ok())
        && let Err(error) = state
            .remote
            .start(state.clone(), ip, config.port.unwrap_or(0))
            .await
    {
        eprintln!("remote startup failed: {error}");
    }
    let app = routes(state.clone());
    eprintln!("VibeOne Host listening on {address} (ACP v2)");
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! { _=stopped.changed()=>{}, _=tokio::signal::ctrl_c()=>{} }
            let _ = stop.send(true);
        })
        .await?;
    state.remote.stop().await;
    workbench.stop().await;
    tokio::time::sleep(Duration::from_secs(6)).await;
    workbench.close().await;
    let _ = std::fs::remove_file(data_dir.join("host.json"));
    drop(lock);
    Ok(())
}

fn routes(state: Server) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(ORIGINS.map(|origin| {
            origin
                .parse::<axum::http::HeaderValue>()
                .expect("constant origin")
        }))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
    Router::new()
        .route("/v1/health",get(||async{Json(json!({"name":"vibeone-host","apiVersion":3,"protocolVersion":2,"persistent":true,"version":env!("CARGO_PKG_VERSION")}))}))
        .route("/v1/snapshot",get(snapshot))
        .route("/v1/sync",get(sync_view))
        .route("/v1/workspaces",post(import_workspace))
        .route("/v1/profiles",get(profile_catalog).post(profile))
        .route("/v1/providers/{id}/probe",post(provider_probe))
        .route("/v1/remote",post(remote::configure))
        .route("/v1/devices",get(remote::status))
        .route("/v1/pairing/code",post(remote::pairing_code))
        .route("/v1/pairing/claim",post(remote::claim))
        .route("/v1/pairing/poll",post(remote::poll))
        .route("/v1/devices/{id}/approve",post(remote::approve))
        .route("/v1/devices/{id}/revoke",post(remote::revoke))
        .route("/v1/plugins/inspect",post(plugin_inspect))
        .route("/v1/plugins/prepare",post(plugin_prepare))
        .route("/v1/plugins/commit",post(plugin_commit))
        .route("/v1/plugins/discard",post(plugin_discard))
        .route("/v1/plugins/{id}/disable",post(plugin_disable))
        .route("/v1/plugins/{id}/invoke",post(plugin_invoke))
        .route("/v1/plugins/{id}/operations",post(plugin_operation).layer(DefaultBodyLimit::max(600*1024)))
        .route("/v1/operations/{id}",get(operation_status))
        .route("/v1/operations",get(operation_list))
        .route("/v1/plugin-lifecycle/operations",post(plugin_lifecycle).layer(DefaultBodyLimit::max(600*1024)))
        .route("/v1/plugins/{id}/app",get(plugin_app))
        .route("/v1/diagnostics",get(diagnostics))
        .route("/v1/event-log",get(event_page))
        .route("/v1/events",get(events))
        .route("/v1/sessions",post(create))
        .route("/v1/sessions/{id}/messages",post(submit))
        .route("/v1/sessions/{id}/history",get(history_page))
        .route("/v1/sessions/{id}/attachments",post(upload_attachment).layer(DefaultBodyLimit::max(6*1024*1024)))
        .route("/v1/sessions/{id}/attachments/{attachment}",get(read_attachment))
        .route("/v1/sessions/{id}/attachments/{attachment}/remove",post(remove_attachment))
        .route("/v1/sessions/{id}/cancel",post(cancel))
        .route("/v1/sessions/{id}/queue",post(queue))
        .route("/v1/sessions/{id}/context/resume",post(resume_context))
        .route("/v1/sessions/{id}/configure",post(configure_agent))
        .route("/v1/sessions/{id}/artifacts",get(artifacts).post(capture_artifact))
        .route("/v1/sessions/{id}/changes",get(changes))
        .route("/v1/sessions/{id}/diff",get(diff))
        .route("/v1/sessions/{id}/file",get(read_file))
        .route("/v1/sessions/{id}/tree",get(tree))
        .route("/v1/sessions/{id}/metadata",post(metadata))
        .route("/v1/sessions/{id}/approvals/{request}",post(decide))
        .route("/v1/sessions/{id}/inputs/{request}",post(answer))
        .route("/v1/host/stop",post(shutdown))
        .route("/v1",any(||async{StatusCode::NOT_FOUND}))
        .route("/v1/{*path}",any(||async{StatusCode::NOT_FOUND}))
        .layer(DefaultBodyLimit::max(262_144))
        .layer(middleware::from_fn_with_state(state.clone(),authorize))
        .layer(cors)
        .layer(middleware::from_fn(errors::normalize)).with_state(state)
}

async fn authorize(
    State(state): State<Server>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_owned();
    let valid_origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|origin| origin.to_str().ok())
        .is_none_or(|origin| {
            if state.is_remote {
                state.remote.url().as_deref() == Some(origin)
            } else {
                ORIGINS.contains(&origin)
            }
        });
    if !valid_origin {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"不允许的访问来源"})),
        )
            .into_response();
    }
    if state.is_remote && matches!(path.as_str(), "/v1/pairing/claim" | "/v1/pairing/poll") {
        return next.run(request).await;
    }
    if path == "/v1/events" {
        return next.run(request).await;
    }
    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let token = bearer.or_else(|| remote::cookie(request.headers()));
    let Some(identity) = token.and_then(|token| remote::identity(&state, token)) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"设备未配对、已过期或已撤销"})),
        )
            .into_response();
    };
    if state.is_remote
        && bearer.is_none()
        && request.method() != Method::GET
        && !request.headers().contains_key(header::ORIGIN)
    {
        return (StatusCode::FORBIDDEN, Json(json!({"error":"缺少请求来源"}))).into_response();
    }
    if identity.device.is_some() {
        let parts: Vec<_> = path.split('/').collect();
        let allowed = if parts.get(2) == Some(&"sessions") && parts.len() > 3 {
            if let Ok(entry) = state.workbench.entry(parts[3]) {
                let workspace = entry.view.lock().expect("view poisoned").workspace.clone();
                let snapshot = state.workbench.snapshot();
                let workspace_id = snapshot["workspaces"]
                    .as_array()
                    .and_then(|items| items.iter().find(|item| item["path"] == workspace))
                    .and_then(|item| item["id"].as_str())
                    .unwrap_or_default();
                let action = if request.method() == Method::GET {
                    "read"
                } else if parts.get(4) == Some(&"approvals") {
                    "approve"
                } else {
                    "operate"
                };
                identity.allowed(workspace_id, action)
            } else {
                false
            }
        } else {
            matches!(
                path.as_str(),
                "/v1/health" | "/v1/snapshot" | "/v1/event-log" | "/v1/sync"
            ) || path == "/v1/sessions" && request.method() == Method::POST
        };
        if !allowed {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error":"此设备没有执行该操作的权限"})),
            )
                .into_response();
        }
    }
    let mut request = request;
    request.extensions_mut().insert(identity);
    next.run(request).await
}

async fn import_workspace(
    State(state): State<Server>,
    Json(body): Json<WorkspaceImportRequest>,
) -> ApiResult {
    domain_command(async move { state.workbench.import_workspace(&body.path).await })
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn profile_catalog(State(state): State<Server>) -> Json<ProfileCatalogResponse> {
    Json(state.workbench.profile_catalog())
}
async fn profile(
    State(state): State<Server>,
    Json(body): Json<ProfileRequest>,
) -> ApiResult<ProfileResponse> {
    domain_command(async move { state.workbench.save_profile(body).await })
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn provider_probe(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<ProviderProbeRequest>,
) -> ApiResult<ProviderProbeResponse> {
    domain_command(async move {
        state
            .workbench
            .probe_provider(&id, body.profile_id.as_deref())
            .await
    })
    .await
    .map(Json)
    .map_err(domain_fail)
}
async fn diagnostics(State(state): State<Server>) -> Json<Value> {
    Json(state.workbench.diagnostics().await)
}
#[derive(Deserialize)]
struct Cursor {
    #[serde(default)]
    after: u64,
}
async fn event_page(
    State(state): State<Server>,
    Query(query): Query<Cursor>,
    Extension(identity): Extension<remote::Identity>,
) -> ApiResult {
    let mut page = state
        .workbench
        .event_page(query.after)
        .await
        .map_err(domain_fail)?;
    if identity.device.is_some() {
        let visible = remote::filter_snapshot(state.workbench.snapshot_view(), &identity);
        let ids = visible.sessions;
        if let Some(events) = page["events"].as_array_mut() {
            events.retain(|event| ids.iter().any(|session| event["sessionId"] == session.id));
        }
    }
    Ok(Json(page))
}

fn workspace(state: &Server, id: &str) -> Result<String, (StatusCode, Json<Value>)> {
    state.workbench.session_workspace(id).map_err(domain_fail)
}
#[derive(Deserialize)]
struct FileQuery {
    #[serde(default)]
    path: String,
    #[serde(default)]
    staged: bool,
}
async fn configure_agent(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let config_id = body["id"]
        .as_str()
        .ok_or_else(|| {
            domain_fail(crate::domain_error::DomainError::new(
                crate::domain_error::ErrorKind::InvalidInput,
                "请选择配置项",
            ))
        })?
        .to_owned();
    domain_command(async move {
        state
            .workbench
            .configure(&id, &config_id, body["value"].clone())
            .await
    })
    .await
    .map(|_| Json(json!({"updated":true})))
    .map_err(domain_fail)
}
async fn artifacts(State(state): State<Server>, Path(id): Path<String>) -> ApiResult {
    state
        .workbench
        .artifacts(&id)
        .map(Json)
        .map_err(domain_fail)
}
async fn capture_artifact(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let path = body["path"]
        .as_str()
        .ok_or_else(|| {
            domain_fail(crate::domain_error::DomainError::new(
                crate::domain_error::ErrorKind::InvalidInput,
                "请选择文件",
            ))
        })?
        .to_owned();
    domain_command(async move { state.workbench.capture_artifact(&id, &path).await })
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn changes(State(state): State<Server>, Path(id): Path<String>) -> ApiResult {
    crate::files::changes(&workspace(&state, &id)?)
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn diff(
    State(state): State<Server>,
    Path(id): Path<String>,
    Query(query): Query<FileQuery>,
) -> ApiResult {
    crate::files::diff(&workspace(&state, &id)?, &query.path, query.staged)
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn read_file(
    State(state): State<Server>,
    Path(id): Path<String>,
    Query(query): Query<FileQuery>,
) -> ApiResult {
    crate::files::read(&workspace(&state, &id)?, &query.path)
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn tree(
    State(state): State<Server>,
    Path(id): Path<String>,
    Query(query): Query<FileQuery>,
) -> ApiResult {
    crate::files::tree(
        &workspace(&state, &id)?,
        if query.path.is_empty() {
            "."
        } else {
            &query.path
        },
    )
    .await
    .map(Json)
    .map_err(domain_fail)
}
async fn plugin_inspect(Json(body): Json<Value>) -> ApiResult {
    let path = body["path"].as_str().ok_or_else(|| {
        domain_fail(crate::domain_error::DomainError::new(
            crate::domain_error::ErrorKind::InvalidInput,
            "请选择插件目录",
        ))
    })?;
    crate::plugins::inspect(PathBuf::from(path))
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn plugin_prepare(State(state): State<Server>, Json(body): Json<Value>) -> ApiResult {
    domain_command(async move {
        state
            .workbench
            .plugins
            .prepare(&state.workbench, body)
            .await
    })
    .await
    .map(Json)
    .map_err(domain_fail)
}

async fn plugin_commit(
    State(state): State<Server>,
    Json(body): Json<PluginTicketRequest>,
) -> ApiResult {
    domain_command(async move {
        state
            .workbench
            .plugins
            .commit(&state.workbench, &body.ticket)
            .await
    })
    .await
    .map(Json)
    .map_err(domain_fail)
}
async fn plugin_discard(
    State(state): State<Server>,
    Json(body): Json<PluginTicketRequest>,
) -> Json<Value> {
    state.workbench.plugins.discard(&body.ticket);
    Json(json!({"discarded":true}))
}
async fn plugin_disable(State(state): State<Server>, Path(id): Path<String>) -> ApiResult {
    domain_command(async move { state.workbench.plugins.disable(&state.workbench, &id).await })
        .await
        .map(|_| Json(json!({"disabled":true})))
        .map_err(domain_fail)
}
async fn plugin_invoke(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    domain_command(async move {
        state
            .workbench
            .plugins
            .invoke(&state.workbench, &id, body)
            .await
    })
    .await
    .map(Json)
    .map_err(domain_fail)
}
async fn plugin_operation(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<PluginOperationReceipt>), (StatusCode, Json<Value>)> {
    domain_command(async move { state.workbench.submit_plugin_operation(&id, body).await })
        .await
        .map(|receipt| (StatusCode::ACCEPTED, Json(receipt)))
        .map_err(domain_fail)
}
async fn plugin_lifecycle(
    State(state): State<Server>,
    Json(request): Json<PluginLifecycleRequest>,
) -> Result<(StatusCode, Json<PluginOperationReceipt>), (StatusCode, Json<Value>)> {
    domain_command(async move { state.workbench.submit_plugin_lifecycle(request).await })
        .await
        .map(|receipt| (StatusCode::ACCEPTED, Json(receipt)))
        .map_err(domain_fail)
}
async fn operation_status(
    State(state): State<Server>,
    Path(id): Path<String>,
) -> ApiResult<PluginOperationRecord> {
    state
        .workbench
        .operation(&id)
        .map(Json)
        .map_err(domain_fail)
}
async fn operation_list(State(state): State<Server>) -> Json<PluginOperationListResponse> {
    Json(PluginOperationListResponse {
        operations: state.workbench.operation_summaries(),
    })
}
async fn plugin_app(State(state): State<Server>, Path(id): Path<String>) -> ApiResult {
    use crate::domain_error::{DomainError, ErrorKind};
    let record = state
        .workbench
        .catalog("plugin")
        .into_iter()
        .find(|record| record["id"] == id)
        .ok_or_else(|| domain_fail(DomainError::new(ErrorKind::PluginNotFound, "插件不存在")))?;
    if record["enabled"] != true {
        return Err(domain_fail(DomainError::new(
            ErrorKind::PluginDisabled,
            "插件未启用",
        )));
    }
    crate::plugins::Plugins::app(record)
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn snapshot(
    State(state): State<Server>,
    Extension(identity): Extension<remote::Identity>,
) -> Json<SnapshotResponse> {
    Json(remote::filter_snapshot(
        state.workbench.snapshot_view(),
        &identity,
    ))
}
#[derive(Deserialize)]
struct SyncCursor {
    after: Option<u64>,
    epoch: Option<String>,
}
async fn sync_view(
    State(state): State<Server>,
    Query(query): Query<SyncCursor>,
    Extension(identity): Extension<remote::Identity>,
) -> ApiResult {
    let view = state
        .workbench
        .sync_view(query.after, query.epoch.as_deref())
        .await
        .map_err(domain_fail)?;
    let mut snapshot = serde_json::to_value(remote::filter_snapshot(view.snapshot, &identity))
        .map_err(|_| {
            domain_fail(crate::domain_error::DomainError::new(
                crate::domain_error::ErrorKind::Internal,
                "无法编码同步快照",
            ))
        })?;
    let cursor = snapshot["revision"].clone();
    if let Some(reason) = view.reset {
        return Ok(Json(
            json!({"version":1,"epoch":view.epoch,"cursor":cursor,"reset":reason,"snapshot":snapshot}),
        ));
    }
    let sessions = snapshot
        .as_object_mut()
        .expect("snapshot object")
        .remove("sessions")
        .unwrap_or(json!([]));
    let visible: Vec<_> = sessions
        .as_array()
        .unwrap()
        .iter()
        .map(|session| session["id"].clone())
        .collect();
    let mut events: Vec<_> = sessions.as_array().unwrap().iter().filter_map(|session| {
        let id = session["id"].as_str()?;
        let sequence = view.changed.get(id)?;
        Some(json!({"id":format!("{}:{sequence}:{id}",view.epoch),"cursor":sequence,"type":"session.projected","session":session}))
    }).collect();
    events.sort_by_key(|event| event["cursor"].as_u64());
    Ok(Json(
        json!({"version":1,"epoch":view.epoch,"from":query.after,"cursor":cursor,"events":events,"visibleSessionIds":visible,"metadata":snapshot}),
    ))
}

async fn create(
    State(state): State<Server>,
    Extension(identity): Extension<remote::Identity>,
    Json(body): Json<CreateSessionRequest>,
) -> ApiResult<CreateSessionResponse> {
    let snapshot = state.workbench.snapshot();
    if identity.device.is_some() {
        let workspace = snapshot["workspaces"]
            .as_array()
            .and_then(|items| items.iter().find(|item| item["path"] == body.workspace))
            .and_then(|item| item["id"].as_str())
            .unwrap_or_default();
        if !identity.allowed(workspace, "operate") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error":"该工作区未授权执行"})),
            ));
        }
    }
    domain_command(async move {
        state
            .workbench
            .create_with_key(
                &body.provider,
                &body.workspace,
                body.profile_id.as_deref(),
                body.key.as_deref(),
            )
            .await
    })
    .await
    .map(|id| Json(CreateSessionResponse { id }))
    .map_err(domain_fail)
}
async fn submit(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<SubmitMessageRequest>,
) -> Result<(StatusCode, Json<SubmitMessageReceipt>), (StatusCode, Json<Value>)> {
    domain_command(async move {
        state
            .workbench
            .submit(&id, body.text, body.key, body.files, body.attachments)
            .await
    })
    .await
    .map(|result| (StatusCode::ACCEPTED, Json(result)))
    .map_err(domain_fail)
}
async fn upload_attachment(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<AttachmentUploadRequest>,
) -> ApiResult {
    domain_command(async move {
        state
            .workbench
            .upload_attachment(&id, &body.name, &body.mime_type, &body.data)
            .await
    })
    .await
    .map(Json)
    .map_err(domain_fail)
}
async fn read_attachment(
    State(state): State<Server>,
    Path((id, attachment)): Path<(String, String)>,
) -> ApiResult {
    state
        .workbench
        .read_attachment(&id, &attachment)
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn remove_attachment(
    State(state): State<Server>,
    Path((id, attachment)): Path<(String, String)>,
) -> ApiResult {
    domain_command(async move {
        state
            .workbench
            .remove_draft_attachment(&id, &attachment)
            .await
    })
    .await
    .map(Json)
    .map_err(domain_fail)
}
#[derive(Deserialize)]
struct HistoryQuery {
    before: Option<u64>,
    limit: Option<u16>,
}
async fn history_page(
    State(state): State<Server>,
    Path(id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> ApiResult {
    state
        .workbench
        .history_page(&id, query.before, query.limit.unwrap_or(128))
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn cancel(
    State(state): State<Server>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> ApiResult<CancelResponse> {
    let body: CancelRequest = if body.is_empty() {
        CancelRequest::default()
    } else {
        serde_json::from_slice(&body).map_err(|_| {
            domain_fail(crate::domain_error::DomainError::new(
                crate::domain_error::ErrorKind::InvalidInput,
                "停止请求格式无效",
            ))
        })?
    };
    domain_command(async move {
        state
            .workbench
            .cancel_with_receipt(&id, body.key.as_deref(), body.run_id.as_deref())
            .await
    })
    .await
    .map(|_| {
        Json(CancelResponse {
            cancel_requested: true,
        })
    })
    .map_err(domain_fail)
}
async fn resume_context(State(state): State<Server>, Path(id): Path<String>) -> ApiResult {
    domain_command(async move { state.workbench.resume_context(&id).await })
        .await
        .map(|_| Json(json!({"resumeOnNextRun":true})))
        .map_err(domain_fail)
}
async fn queue(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<QueueRequest>,
) -> ApiResult<QueueResponse> {
    domain_command(async move { state.workbench.queue_command(&id, body).await })
        .await
        .map(|_| Json(QueueResponse { updated: true }))
        .map_err(domain_fail)
}
async fn metadata(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSessionRequest>,
) -> ApiResult {
    domain_command(async move {
        state
            .workbench
            .metadata(&id, body.title, body.archived)
            .await
    })
    .await
    .map(|_| Json(json!({"updated":true})))
    .map_err(domain_fail)
}
async fn decide(
    State(state): State<Server>,
    Path((id, request)): Path<(String, String)>,
    Json(body): Json<ApprovalDecisionRequest>,
) -> ApiResult {
    domain_command(async move { state.workbench.decide(&id, &request, &body.option).await })
        .await
        .map(|_| Json(json!({"submitted":true})))
        .map_err(domain_fail)
}
async fn answer(
    State(state): State<Server>,
    Path((id, request)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> ApiResult {
    domain_command(async move { state.workbench.answer(&id, &request, body).await })
        .await
        .map(|_| Json(json!({"submitted":true})))
        .map_err(domain_fail)
}
async fn shutdown(State(state): State<Server>) -> Json<Value> {
    state.workbench.stop().await;
    let _ = state.stop.send(true);
    Json(json!({"stopping":true}))
}
async fn events(State(state): State<Server>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let valid = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|origin| {
            if state.is_remote {
                state.remote.url().as_deref() == Some(origin)
            } else {
                ORIGINS.contains(&origin)
            }
        });
    if !valid {
        return StatusCode::FORBIDDEN.into_response();
    }
    let cookie = remote::cookie(&headers).map(str::to_owned);
    ws.max_message_size(8192)
        .on_upgrade(move |socket| socket_loop(socket, state, cookie))
}
async fn socket_loop(mut socket: WebSocket, state: Server, cookie: Option<String>) {
    let token = match tokio::time::timeout(Duration::from_secs(5), socket.recv()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|value| value["token"].as_str().map(str::to_owned))
            .or(cookie),
        _ => None,
    };
    let Some(token) = token.filter(|token| remote::identity(&state, token).is_some()) else {
        let _ = socket.close().await;
        return;
    };
    let mut updates = state.workbench.events.subscribe();
    let mut stopped = state.stop.subscribe();
    let (mut output, mut input) = socket.split();
    if output
        .send(Message::Text(json!({"type":"ready"}).to_string().into()))
        .await
        .is_err()
    {
        return;
    }
    let mut expiry = tokio::time::interval(Duration::from_secs(3));
    loop {
        tokio::select! {
            _=expiry.tick()=>{if remote::identity(&state,&token).is_none(){break}},
            _=stopped.changed()=>break,
            result=input.next()=>match result {Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,_=>{}},
            event=updates.recv()=>{
                if remote::identity(&state,&token).is_none(){break}
                if event.is_err(){break} // Slow subscribers reconnect using the bounded cursor feed.
                let message=json!({"type":"changed","cursor":state.workbench.revision.load(std::sync::atomic::Ordering::SeqCst)});
                if !matches!(tokio::time::timeout(Duration::from_secs(3),output.send(Message::Text(message.to_string().into()))).await,Ok(Ok(()))){break}
            }
        }
    }
}

#[cfg(test)]
mod sync_socket_tests {
    use super::*;
    use tokio_tungstenite::{
        connect_async,
        tungstenite::{Message as ClientMessage, client::IntoClientRequest},
    };

    #[tokio::test]
    async fn lagged_subscription_disconnects_and_can_authenticate_again() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        let (stop, _) = watch::channel(false);
        let state = Server {
            workbench: workbench.clone(),
            token: "test-token".into(),
            stop: stop.clone(),
            remote: Arc::new(remote::Remote::new(directory.path().to_path_buf())),
            is_remote: false,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, routes(state)).await.unwrap();
        });
        let connect = || async {
            let mut request = format!("ws://{address}/v1/events")
                .into_client_request()
                .unwrap();
            request
                .headers_mut()
                .insert("origin", ORIGINS[0].parse().unwrap());
            let (mut socket, _) = connect_async(request).await.unwrap();
            socket
                .send(ClientMessage::Text(
                    json!({"token":"test-token"}).to_string().into(),
                ))
                .await
                .unwrap();
            let ready = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&ready).unwrap()["type"],
                "ready"
            );
            socket
        };
        let mut socket = connect().await;
        // No yield: on the current-thread executor the actual socket consumer
        // cannot drain the bounded broadcast before this burst fills it.
        for _ in 0..256 {
            let _ = workbench.events.send(0);
        }
        let ended = tokio::time::timeout(Duration::from_secs(3), socket.next())
            .await
            .unwrap();
        assert!(
            !matches!(ended, Some(Ok(ClientMessage::Text(_)))),
            "a lagged subscriber must reconnect instead of silently skipping"
        );
        let mut reconnected = connect().await;
        reconnected.close(None).await.unwrap();
        let _ = stop.send(true);
        server.abort();
        let _ = server.await;
        workbench.close().await;
    }
}
