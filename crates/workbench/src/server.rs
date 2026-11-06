use crate::{providers::providers, state::Workbench};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
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
}
type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;
fn fail(message: impl Into<String>) -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":message.into()})),
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
    };
    let cors = CorsLayer::new()
        .allow_origin(ORIGINS.map(|origin| {
            origin
                .parse::<axum::http::HeaderValue>()
                .expect("constant origin")
        }))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
    let app=Router::new()
        .route("/v1/health",get(||async{Json(json!({"name":"vibeone-host","protocolVersion":2,"persistent":true,"version":env!("CARGO_PKG_VERSION")}))}))
        .route("/v1/snapshot",get(snapshot))
        .route("/v1/events",get(events))
        .route("/v1/sessions",post(create))
        .route("/v1/sessions/{id}/messages",post(submit))
        .route("/v1/sessions/{id}/cancel",post(cancel))
        .route("/v1/sessions/{id}/queue",post(queue))
        .route("/v1/sessions/{id}/metadata",post(metadata))
        .route("/v1/sessions/{id}/approvals/{request}",post(decide))
        .route("/v1/host/stop",post(shutdown))
        .layer(DefaultBodyLimit::max(40_000))
        .layer(middleware::from_fn_with_state(state.clone(),authorize))
        .layer(cors).with_state(state);
    eprintln!("VibeOne Host listening on {address} (ACP v2)");
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! { _=stopped.changed()=>{}, _=tokio::signal::ctrl_c()=>{} }
            let _ = stop.send(true);
        })
        .await?;
    workbench.stop().await;
    tokio::time::sleep(Duration::from_secs(6)).await;
    workbench.close().await;
    let _ = std::fs::remove_file(data_dir.join("host.json"));
    drop(lock);
    Ok(())
}

async fn authorize(
    State(state): State<Server>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if let Some(origin) = request.headers().get(header::ORIGIN)
        && !origin
            .to_str()
            .is_ok_and(|origin| ORIGINS.contains(&origin))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if request.uri().path() != "/v1/events"
        && request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            != Some(&format!("Bearer {}", state.token))
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    next.run(request).await
}
async fn snapshot(State(state): State<Server>) -> Json<Value> {
    Json(state.workbench.snapshot())
}
#[derive(Deserialize)]
struct Create {
    provider: String,
    workspace: String,
}
async fn create(State(state): State<Server>, Json(body): Json<Create>) -> ApiResult {
    state
        .workbench
        .create(&body.provider, &body.workspace)
        .await
        .map(|id| Json(json!({"id":id})))
        .map_err(fail)
}
#[derive(Deserialize)]
struct Submit {
    text: String,
    key: Option<String>,
}
async fn submit(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<Submit>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    state
        .workbench
        .submit(&id, body.text, body.key)
        .await
        .map(|result| (StatusCode::ACCEPTED, Json(result)))
        .map_err(fail)
}
async fn cancel(State(state): State<Server>, Path(id): Path<String>) -> ApiResult {
    state
        .workbench
        .cancel(&id)
        .await
        .map(|_| Json(json!({"cancelRequested":true})))
        .map_err(fail)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Queue {
    withdraw: Option<String>,
    #[serde(default)]
    resume: bool,
    #[serde(default)]
    fresh_context: bool,
}
async fn queue(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<Queue>,
) -> ApiResult {
    state
        .workbench
        .queue_action(&id, body.withdraw, body.resume, body.fresh_context)
        .await
        .map(|_| Json(json!({"updated":true})))
        .map_err(fail)
}
#[derive(Deserialize)]
struct Metadata {
    title: Option<String>,
    archived: Option<bool>,
}
async fn metadata(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<Metadata>,
) -> ApiResult {
    state
        .workbench
        .metadata(&id, body.title, body.archived)
        .await
        .map(|_| Json(json!({"updated":true})))
        .map_err(fail)
}
#[derive(Deserialize)]
struct Decision {
    option: String,
}
async fn decide(
    State(state): State<Server>,
    Path((id, request)): Path<(String, String)>,
    Json(body): Json<Decision>,
) -> ApiResult {
    state
        .workbench
        .decide(&id, &request, &body.option)
        .await
        .map(|_| Json(json!({"submitted":true})))
        .map_err(fail)
}
async fn shutdown(State(state): State<Server>) -> Json<Value> {
    state.workbench.stop().await;
    let _ = state.stop.send(true);
    Json(json!({"stopping":true}))
}
async fn events(State(state): State<Server>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    if !headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|origin| ORIGINS.contains(&origin))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.max_message_size(8192)
        .on_upgrade(move |socket| socket_loop(socket, state))
}
async fn socket_loop(mut socket: WebSocket, state: Server) {
    let authorized = match tokio::time::timeout(Duration::from_secs(5), socket.recv()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Value>(&text)
            .ok()
            .is_some_and(|value| value["token"] == state.token),
        _ => false,
    };
    if !authorized {
        let _ = socket.close().await;
        return;
    }
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
    loop {
        tokio::select! {
            _=stopped.changed()=>break,
            result=input.next()=>match result {Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,_=>{}},
            event=updates.recv()=>{
                if matches!(event,Err(tokio::sync::broadcast::error::RecvError::Closed)){break}
                let message=json!({"type":"changed"});
                if !matches!(tokio::time::timeout(Duration::from_secs(3),output.send(Message::Text(message.to_string().into()))).await,Ok(Ok(()))){break}
            }
        }
    }
}
