use super::*;
use crate::domain_error::{DomainError, ErrorKind};
mod tls;
use axum::extract::ConnectInfo;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    path::Path as FsPath,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tls::{load_certificate, tls_invalid, write_private};

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn secret() -> String {
    format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4())
}
fn hash(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
struct Claim {
    id: String,
    name: String,
    hash: String,
    expires: u64,
    token: Option<String>,
    denied: bool,
}
struct Running {
    id: String,
    url: String,
    handle: axum_server::Handle<SocketAddr>,
}
pub(super) struct Remote {
    directory: PathBuf,
    web: PathBuf,
    running: Mutex<Option<Running>>,
    code: Mutex<Option<(String, u64)>>,
    claims: Mutex<HashMap<String, Claim>>,
    attempts: Mutex<HashMap<IpAddr, (u64, u8)>>,
    gate: tokio::sync::Mutex<()>,
}
impl Remote {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            web: std::env::var_os("VIBEONE_WEB_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    FsPath::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/dist")
                }),
            running: Mutex::default(),
            code: Mutex::default(),
            claims: Mutex::default(),
            attempts: Mutex::default(),
            gate: tokio::sync::Mutex::new(()),
        }
    }
    pub fn url(&self) -> Option<String> {
        self.running
            .lock()
            .expect("remote poisoned")
            .as_ref()
            .map(|running| running.url.clone())
    }
    pub async fn stop(&self) {
        let _gate = self.gate.lock().await;
        self.stop_locked();
    }
    fn stop_locked(&self) {
        if let Some(running) = self.running.lock().expect("remote poisoned").take() {
            running.handle.shutdown();
        }
        self.code.lock().expect("pairing poisoned").take();
        self.claims.lock().expect("pairing poisoned").clear();
    }
    fn attempts(&self, ip: IpAddr) -> bool {
        let mut attempts = self.attempts.lock().expect("pairing poisoned");
        attempts.retain(|_, (started, _)| now().saturating_sub(*started) < 300);
        if attempts.len() > 1024 {
            return false;
        }
        let entry = attempts.entry(ip).or_insert((now(), 0));
        entry.1 = entry.1.saturating_add(1);
        entry.1 <= 12
    }
    pub async fn start(&self, state: Server, ip: IpAddr, port: u16) -> Result<Value, DomainError> {
        let _gate = self.gate.lock().await;
        self.start_locked(state, ip, port).await
    }
    async fn start_locked(
        &self,
        state: Server,
        ip: IpAddr,
        port: u16,
    ) -> Result<Value, DomainError> {
        state.workbench.command_available()?;
        if self.url().is_some() {
            return Err(remote_error(
                ErrorKind::RemoteAlreadyRunning,
                "远程入口已开启，请先关闭再修改地址",
            ));
        }
        let private = match ip {
            IpAddr::V4(ip) => {
                ip.is_private()
                    || ip.is_loopback()
                    || ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1])
            }
            IpAddr::V6(ip) => ip.is_unique_local() || ip.is_loopback(),
        };
        if !private {
            return Err(remote_error(
                ErrorKind::RemoteAddressForbidden,
                "请选择本机局域网或可信网络地址，不允许通配或公网地址",
            ));
        }
        if !self.web.join("index.html").is_file() {
            return Err(remote_error(
                ErrorKind::RemoteWebUnavailable,
                "手机页面未构建，请先构建桌面网页资源",
            ));
        }
        // Reserve the requested address before changing any certificate files.
        let listener = std::net::TcpListener::bind(SocketAddr::new(ip, port)).map_err(|error| {
            remote_error(
                if error.kind() == std::io::ErrorKind::AddrInUse {
                    ErrorKind::RemoteAddressInUse
                } else {
                    ErrorKind::RemoteUnavailable
                },
                "无法监听该本机地址或端口，请检查网络设置",
            )
        })?;
        listener
            .set_nonblocking(true)
            .map_err(|_| remote_error(ErrorKind::RemoteUnavailable, "无法设置远程监听器"))?;
        let address = listener
            .local_addr()
            .map_err(|_| remote_error(ErrorKind::RemoteUnavailable, "无法读取远程监听地址"))?;
        let directory = self.directory.clone();
        let tls = tokio::task::spawn_blocking(move || load_certificate(&directory, ip))
            .await
            .map_err(|_| {
                remote_error(ErrorKind::RemoteTlsUnavailable, "远程证书读取任务未完成")
            })??;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let config = axum_server::tls_rustls::RustlsConfig::from_pem(
            tls["chain"]
                .as_str()
                .ok_or_else(tls_invalid)?
                .as_bytes()
                .to_vec(),
            tls["key"]
                .as_str()
                .ok_or_else(tls_invalid)?
                .as_bytes()
                .to_vec(),
        )
        .await
        .map_err(|_| tls_invalid())?;
        let directory = self.directory.clone();
        let saved = tls.clone();
        tokio::task::spawn_blocking(move || {
            write_private(
                &directory.join("remote-tls.json"),
                &serde_json::to_vec(&saved).map_err(|_| tls_invalid())?,
            )?;
            write_private(
                &directory.join("VibeOne-Root-CA.crt"),
                saved["ca"].as_str().ok_or_else(tls_invalid)?.as_bytes(),
            )
        })
        .await
        .map_err(|_| remote_error(ErrorKind::RemoteTlsUnavailable, "远程证书保存任务未完成"))??;
        let url = format!("https://{address}");
        let qr = qrcode::QrCode::new(url.as_bytes())
            .map_err(|_| remote_error(ErrorKind::Internal, "无法生成远程入口二维码"))?
            .render::<qrcode::render::svg::Color>()
            .min_dimensions(200, 200)
            .build();
        let handle = axum_server::Handle::new();
        let remote_state = Server {
            is_remote: true,
            ..state.clone()
        };
        let app = routes(remote_state).fallback_service(
            tower_http::services::ServeDir::new(&self.web).not_found_service(
                tower_http::services::ServeFile::new(self.web.join("index.html")),
            ),
        );
        let server = axum_server::from_tcp_rustls(listener, config)
            .map_err(|_| remote_error(ErrorKind::RemoteUnavailable, "无法启动远程监听器"))?
            .handle(handle.clone())
            .serve(app.into_make_service_with_connect_info::<SocketAddr>());
        let id = uuid::Uuid::new_v4().to_string();
        *self.running.lock().expect("remote poisoned") = Some(Running {
            id: id.clone(),
            url: url.clone(),
            handle: handle.clone(),
        });
        let mut stopped = state.stop.subscribe();
        let remote = Arc::downgrade(&state.remote);
        let events = state.workbench.events.clone();
        tokio::spawn(async move {
            tokio::select! { _=server=>{}, _=stopped.changed()=>handle.shutdown() }
            if let Some(remote) = remote.upgrade() {
                let _gate = remote.gate.lock().await;
                let current = remote
                    .running
                    .lock()
                    .expect("remote poisoned")
                    .as_ref()
                    .is_some_and(|running| running.id == id);
                if current {
                    remote.stop_locked();
                    let _ = events.send(0);
                }
            }
        });
        Ok(json!({"url":url,"qr":qr,"certificatePath":self.directory.join("VibeOne-Root-CA.crt")}))
    }
}
fn remote_error(kind: ErrorKind, message: &str) -> DomainError {
    DomainError::new(kind, message)
}

#[derive(Clone)]
pub(super) struct Identity {
    pub device: Option<Value>,
}
impl Identity {
    pub fn owner() -> Self {
        Self { device: None }
    }
    pub fn role(&self, workspace: &str) -> Option<&str> {
        match &self.device {
            None => Some("owner"),
            Some(device) => {
                if device["workspaces"]
                    .as_array()
                    .is_some_and(|items| items.iter().any(|item| item == workspace))
                {
                    device["role"].as_str()
                } else {
                    None
                }
            }
        }
    }
    pub fn allowed(&self, workspace: &str, action: &str) -> bool {
        match self.role(workspace) {
            Some("owner") => true,
            Some("operator") => matches!(action, "read" | "operate" | "approve"),
            Some("approver") => matches!(action, "read" | "approve"),
            Some("viewer") => action == "read",
            _ => false,
        }
    }
}
pub(super) fn identity(state: &Server, token: &str) -> Option<Identity> {
    if !state.is_remote && token == state.token {
        return Some(Identity::owner());
    }
    let hashed = hash(token);
    state
        .workbench
        .catalog("device")
        .into_iter()
        .find(|device| {
            device["tokenHash"] == hashed
                && device["revoked"] != true
                && device["expiresAt"]
                    .as_u64()
                    .is_some_and(|expires| expires > now())
        })
        .map(|device| Identity {
            device: Some(device),
        })
}
pub(super) fn cookie(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|cookie| cookie.trim().split_once('='))
        .find(|(name, _)| *name == "vibeone_device")
        .map(|(_, value)| value)
}
pub(super) fn filter_snapshot(
    mut snapshot: crate::contracts::SnapshotResponse,
    identity: &Identity,
) -> crate::contracts::SnapshotResponse {
    let Some(device) = identity.device.as_ref() else {
        return snapshot;
    };
    snapshot
        .metadata
        .workspaces
        .retain(|workspace| identity.allowed(&workspace.id, "read"));
    let paths: std::collections::HashSet<_> = snapshot
        .metadata
        .workspaces
        .iter()
        .map(|workspace| workspace.path.clone())
        .collect();
    snapshot
        .sessions
        .retain(|session| paths.contains(&session.workspace));
    for session in &mut snapshot.sessions {
        if let Some(profile) = session.profile.as_mut() {
            profile.details.redact();
        }
    }
    if snapshot.metadata.storage_error.is_some() {
        snapshot.metadata.storage_error = Some("主机本地存储不可用，请在电脑检查诊断".into());
    }
    snapshot.metadata.example_plugin_path = None;
    snapshot.metadata.profile_issues.clear();
    snapshot.metadata.plugin_events.clear();
    snapshot.metadata.plugins.clear();
    snapshot.metadata.notifications.clear();
    snapshot.metadata.operations.clear();
    for profile in &mut snapshot.metadata.profiles {
        profile.details.redact();
    }
    snapshot.metadata.device = Some(crate::contracts::DeviceView {
        id: device["id"].as_str().map(str::to_owned),
        role: device["role"].as_str().map(str::to_owned),
    });
    snapshot
}

pub(super) async fn configure(State(state): State<Server>, Json(body): Json<Value>) -> ApiResult {
    domain_command(async move { configure_remote(&state, body).await })
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn configure_remote(state: &Server, body: Value) -> Result<Value, DomainError> {
    let _gate = state.remote.gate.lock().await;
    if body["enabled"] == false {
        state.remote.stop_locked();
        state
            .workbench
            .save_catalog("setting", "remote", json!({"id":"remote","enabled":false}))
            .await?;
        return Ok(json!({"enabled":false}));
    }
    if body["enabled"] != true {
        return Err(remote_error(
            ErrorKind::InvalidInput,
            "请选择远程入口启停状态",
        ));
    }
    let ip: IpAddr = body["ip"]
        .as_str()
        .ok_or_else(|| remote_error(ErrorKind::InvalidInput, "请输入本机局域网IP"))?
        .parse()
        .map_err(|_| remote_error(ErrorKind::InvalidInput, "IP地址无效"))?;
    let port = match body.get("port") {
        None | Some(Value::Null) => 0,
        Some(value) => value
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .ok_or_else(|| remote_error(ErrorKind::InvalidInput, "端口必须为0至65535的整数"))?,
    };
    let status = state.remote.start_locked(state.clone(), ip, port).await?;
    let actual = status["url"]
        .as_str()
        .and_then(|url| url.rsplit(':').next())
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| remote_error(ErrorKind::Internal, "无法确认远程监听端口"))?;
    if let Err(error) = state
        .workbench
        .save_catalog(
            "setting",
            "remote",
            json!({"id":"remote","enabled":true,"ip":ip.to_string(),"port":actual}),
        )
        .await
    {
        state.remote.stop_locked();
        return Err(error);
    }
    Ok(status)
}
fn suggested_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:80").ok()?;
    socket
        .local_addr()
        .ok()
        .map(|address| address.ip().to_string())
}
pub(super) async fn status(State(state): State<Server>) -> Json<Value> {
    let devices = state
        .workbench
        .catalog("device")
        .into_iter()
        .map(|mut device| {
            device.as_object_mut().unwrap().remove("tokenHash");
            device
        })
        .collect::<Vec<_>>();
    let claims = state
        .remote
        .claims
        .lock()
        .expect("pairing poisoned")
        .values()
        .filter(|claim| claim.expires > now() && claim.token.is_none() && !claim.denied)
        .map(|claim| json!({"id":claim.id,"name":claim.name,"expiresAt":claim.expires}))
        .collect::<Vec<_>>();
    Json(
        json!({"url":state.remote.url(),"devices":devices,"claims":claims,"suggestedIp":suggested_ip(),"certificatePath":state.remote.directory.join("VibeOne-Root-CA.crt")}),
    )
}
pub(super) async fn pairing_code(State(state): State<Server>) -> ApiResult {
    let _gate = state.remote.gate.lock().await;
    state.workbench.command_available().map_err(domain_fail)?;
    if state.remote.url().is_none() {
        return Err(domain_fail(remote_error(
            ErrorKind::RemoteDisabled,
            "请先开启HTTPS远程入口",
        )));
    }
    let code = format!("{:08}", uuid::Uuid::new_v4().as_u128() % 100_000_000);
    let expires = now() + 300;
    *state.remote.code.lock().expect("pairing poisoned") = Some((code.clone(), expires));
    Ok(Json(json!({"code":code,"expiresAt":expires})))
}
pub(super) async fn claim(
    State(state): State<Server>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> ApiResult {
    let _gate = state.remote.gate.lock().await;
    state.workbench.command_available().map_err(domain_fail)?;
    if state.remote.url().is_none() {
        return Err(domain_fail(remote_error(
            ErrorKind::RemoteDisabled,
            "远程入口已关闭",
        )));
    }
    if !body.is_object()
        || body
            .get("name")
            .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Err(domain_fail(remote_error(
            ErrorKind::InvalidInput,
            "设备名称或请求类型无效",
        )));
    }
    if !state.remote.attempts(address.ip()) {
        return Err(domain_fail(remote_error(
            ErrorKind::PairingRateLimited,
            "配对尝试过多，请稍后重试",
        )));
    }
    let name = body["name"].as_str().unwrap_or("手机").trim();
    let claim_secret = body["secret"]
        .as_str()
        .ok_or_else(|| domain_fail(remote_error(ErrorKind::InvalidInput, "设备请求缺少凭据")))?;
    if name.is_empty() || name.chars().count() > 80 || !(32..=128).contains(&claim_secret.len()) {
        return Err(domain_fail(remote_error(
            ErrorKind::InvalidInput,
            "设备名称或请求无效",
        )));
    }
    {
        let mut code = state.remote.code.lock().expect("pairing poisoned");
        if !code
            .as_ref()
            .is_some_and(|(code, expires)| body["code"] == *code && *expires > now())
        {
            return Err(domain_fail(remote_error(
                ErrorKind::PairingInvalid,
                "配对码无效或已过期",
            )));
        }
        code.take();
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut claims = state.remote.claims.lock().expect("pairing poisoned");
    claims.retain(|_, claim| claim.expires > now());
    claims.insert(
        id.clone(),
        Claim {
            id: id.clone(),
            name: name.into(),
            hash: hash(claim_secret),
            expires: now() + 300,
            token: None,
            denied: false,
        },
    );
    let _ = state.workbench.events.send(0);
    Ok(Json(json!({"id":id,"status":"pending"})))
}
pub(super) async fn approve(
    State(state): State<Server>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    domain_command(async move { approve_claim(&state, &id, body).await })
        .await
        .map(Json)
        .map_err(domain_fail)
}
fn grant_workspaces(values: &[Value]) -> Option<Vec<String>> {
    let mut ids = values
        .iter()
        .map(|value| value.as_str().map(str::to_owned))
        .collect::<Option<Vec<_>>>()?;
    ids.sort();
    ids.dedup();
    Some(ids)
}
async fn approve_claim(state: &Server, id: &str, body: Value) -> Result<Value, DomainError> {
    if !body.is_object()
        || body
            .get("deny")
            .is_some_and(|value| !value.is_null() && !value.is_boolean())
    {
        return Err(remote_error(
            ErrorKind::InvalidInput,
            "配对决定必须使用布尔拒绝标记",
        ));
    }
    let _gate = state.remote.gate.lock().await;
    let (name, claim_hash, token, denied) = {
        let claims = state.remote.claims.lock().expect("pairing poisoned");
        let claim = claims
            .get(id)
            .filter(|claim| claim.expires > now())
            .ok_or_else(|| remote_error(ErrorKind::PairingExpired, "配对请求已失效"))?;
        (
            claim.name.clone(),
            claim.hash.clone(),
            claim.token.clone(),
            claim.denied,
        )
    };
    if body["deny"] == true {
        if token.is_some() {
            return Err(remote_error(
                ErrorKind::PairingConflict,
                "此请求已批准，请通过撤销设备收回权限",
            ));
        }
        state
            .remote
            .claims
            .lock()
            .expect("pairing poisoned")
            .get_mut(id)
            .expect("claim is protected by remote gate")
            .denied = true;
        return Ok(json!({"denied":true}));
    }
    if denied {
        return Err(remote_error(
            ErrorKind::PairingConflict,
            "此请求已被拒绝，请重新配对",
        ));
    }
    let role = body["role"]
        .as_str()
        .filter(|role| matches!(*role, "viewer" | "operator" | "approver"))
        .ok_or_else(|| remote_error(ErrorKind::InvalidInput, "请选择有效的设备权限"))?;
    let workspaces = body["workspaces"]
        .as_array()
        .filter(|items| !items.is_empty())
        .and_then(|values| grant_workspaces(values))
        .ok_or_else(|| remote_error(ErrorKind::InvalidInput, "请至少授权一个有效工作区"))?;
    let known = state.workbench.snapshot_view().metadata.workspaces;
    if !workspaces
        .iter()
        .all(|id| known.iter().any(|workspace| workspace.id == *id))
    {
        return Err(remote_error(ErrorKind::ResourceForbidden, "工作区授权无效"));
    }
    if let Some(token) = token {
        let same = state.workbench.catalog("device").iter().any(|device| {
            device["id"] == id
                && device["revoked"] != true
                && device["tokenHash"] == hash(&token)
                && device["role"] == role
                && device["workspaces"]
                    .as_array()
                    .and_then(|values| grant_workspaces(values))
                    .as_ref()
                    == Some(&workspaces)
        });
        if same {
            return Ok(json!({"approved":true}));
        }
        return Err(remote_error(
            ErrorKind::PairingConflict,
            "设备授权已变化，请核对已保存决定或重新配对",
        ));
    }
    state.workbench.command_available()?;
    let token = secret();
    let device = json!({"id":id,"name":name,"role":role,"workspaces":workspaces,"tokenHash":hash(&token),"createdAt":now(),"expiresAt":now()+90*86400,"revoked":false});
    state.workbench.save_catalog("device", id, device).await?;
    let mut claims = state.remote.claims.lock().expect("pairing poisoned");
    let claim = claims
        .get_mut(id)
        .filter(|claim| claim.hash == claim_hash)
        .expect("claim is protected by remote gate");
    claim.token = Some(token);
    Ok(json!({"approved":true}))
}
pub(super) async fn poll(State(state): State<Server>, Json(body): Json<Value>) -> Response {
    let _gate = state.remote.gate.lock().await;
    let mut claims = state.remote.claims.lock().expect("pairing poisoned");
    let Some(claim) = body["id"]
        .as_str()
        .and_then(|id| claims.get_mut(id))
        .filter(|claim| {
            body["secret"]
                .as_str()
                .is_some_and(|secret| hash(secret) == claim.hash)
                && claim.expires > now()
        })
    else {
        return domain_fail(remote_error(
            ErrorKind::PairingInvalid,
            "配对请求无效或已过期",
        ))
        .into_response();
    };
    if claim.denied {
        return Json(json!({"status":"denied"})).into_response();
    }
    if let Some(token) = claim.token.as_ref() {
        let valid = state.workbench.catalog("device").iter().any(|device| {
            device["id"] == claim.id
                && device["tokenHash"] == hash(token)
                && device["revoked"] != true
                && device["expiresAt"]
                    .as_u64()
                    .is_some_and(|expires| expires > now())
        });
        if !valid {
            return Json(json!({"status":"denied"})).into_response();
        }
        let cookie = format!(
            "vibeone_device={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age={}",
            90 * 86400
        );
        return (
            [(header::SET_COOKIE, cookie)],
            Json(json!({"status":"approved"})),
        )
            .into_response();
    }
    Json(json!({"status":"pending"})).into_response()
}
pub(super) async fn revoke(State(state): State<Server>, Path(id): Path<String>) -> ApiResult {
    domain_command(async move { revoke_device(&state, &id).await })
        .await
        .map(Json)
        .map_err(domain_fail)
}
async fn revoke_device(state: &Server, id: &str) -> Result<Value, DomainError> {
    let _gate = state.remote.gate.lock().await;
    let mut device = state
        .workbench
        .catalog("device")
        .into_iter()
        .find(|device| device["id"] == id)
        .ok_or_else(|| remote_error(ErrorKind::DeviceNotFound, "设备不存在"))?;
    if device["revoked"] != true {
        device["revoked"] = json!(true);
        if let Err(error) = state.workbench.save_catalog("device", id, device).await {
            state.remote.stop_locked();
            return Err(error);
        }
    }
    if let Some(claim) = state
        .remote
        .claims
        .lock()
        .expect("pairing poisoned")
        .get_mut(id)
    {
        claim.denied = true;
        claim.token = None;
    }
    Ok(json!({"revoked":true}))
}

#[cfg(test)]
mod snapshot_contract_tests {
    use super::*;
    #[tokio::test]
    async fn typed_snapshot_filters_scope_and_private_fields_without_mutating_owner_view() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        let mut original = workbench.snapshot_view();
        original.metadata.workspaces = vec![
            WorkspaceView {
                id: "one".into(),
                path: "/one".into(),
                name: "One".into(),
            },
            WorkspaceView {
                id: "two".into(),
                path: "/two".into(),
                name: "Two".into(),
            },
        ];
        for (id, workspace) in [("s-one", "/one"), ("s-two", "/two")] {
            original.sessions.push(serde_json::from_value(json!({"id":id,"title":"Session","workspace":workspace,"provider":"demo","status":"idle","messages":[],"tools":[],"approvals":[],"profile":{"id":"profile","command":"/private/program","args":["private"],"futureSecret":"private"}})).unwrap());
        }
        original.metadata.storage_error = Some("/private/storage.db".into());
        original.metadata.profiles =
            vec![serde_json::from_value(json!({"id":"profile","name":"Profile","provider":"demo","command":"/private/program","args":["private"],"futureSecret":"private"})).unwrap()];
        original.metadata.profile_issues = vec![crate::contracts::ProfileIssue {
            id: "bad".into(),
            error: "private".into(),
            revision: None,
            record_hash: "private".into(),
        }];
        original.metadata.plugins = vec![json!({"private":"plugin"})];
        original.metadata.plugin_events = vec![json!({"private":"event"})];
        original.metadata.notifications = vec![json!({"private":"notification"})];
        original.metadata.operations = vec![json!({"private":"operation"})];
        let owner =
            serde_json::to_value(filter_snapshot(original.clone(), &Identity::owner())).unwrap();
        assert_eq!(owner, serde_json::to_value(&original).unwrap());
        let device = Identity {
            device: Some(json!({"id":"phone","role":"viewer","workspaces":["one"]})),
        };
        let remote = serde_json::to_value(filter_snapshot(original.clone(), &device)).unwrap();
        assert_eq!(remote["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(remote["sessions"][0]["id"], "s-one");
        assert_eq!(remote["workspaces"].as_array().unwrap().len(), 1);
        assert!(remote["sessions"][0]["profile"].get("command").is_none());
        assert!(remote["profiles"][0].get("args").is_none());
        assert!(remote["profiles"][0].get("futureSecret").is_none());
        assert!(
            remote["sessions"][0]["profile"]
                .get("futureSecret")
                .is_none()
        );
        assert_eq!(remote["profileIssues"], json!([]));
        assert!(remote["examplePluginPath"].is_null());
        for key in ["plugins", "pluginEvents", "notifications", "operations"] {
            assert_eq!(remote[key], json!([]));
        }
        assert!(
            !remote["storageError"]
                .as_str()
                .unwrap()
                .contains("/private")
        );
        assert_eq!(remote["device"], json!({"id":"phone","role":"viewer"}));
        assert_eq!(original.sessions.len(), 2);
        let schema = serde_json::to_value(schemars::schema_for!(SnapshotResponse)).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        assert!(validator.is_valid(&owner));
        assert!(validator.is_valid(&remote));
        let denied = Identity {
            device: Some(json!({"id":"denied","role":"operator","workspaces":[]})),
        };
        assert!(filter_snapshot(original, &denied).sessions.is_empty());
        workbench.close().await;
    }
}

#[cfg(test)]
mod remote_failure_tests {
    use super::*;
    async fn fixture() -> (tempfile::TempDir, Server, String) {
        let directory = tempfile::tempdir().unwrap();
        let web = directory.path().join("web");
        std::fs::create_dir(&web).unwrap();
        std::fs::write(web.join("index.html"), "fixture").unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        let workspace = workbench
            .import_workspace(directory.path().to_str().unwrap())
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut remote = Remote::new(directory.path().to_owned());
        remote.web = web;
        let (stop, _) = watch::channel(false);
        (
            directory,
            Server {
                workbench,
                token: "fixture".into(),
                stop,
                remote: Arc::new(remote),
                is_remote: false,
            },
            workspace,
        )
    }
    fn pending(state: &Server) {
        *state.remote.running.lock().unwrap() = Some(Running {
            id: "fixture".into(),
            url: "https://127.0.0.1:1".into(),
            handle: axum_server::Handle::new(),
        });
        state.remote.claims.lock().unwrap().insert(
            "claim".into(),
            Claim {
                id: "claim".into(),
                name: "Fixture".into(),
                hash: hash("private-fixture"),
                expires: now() + 300,
                token: None,
                denied: false,
            },
        );
    }
    #[tokio::test]
    async fn storage_failure_never_releases_an_unsaved_credential_and_revoke_closes_the_entry() {
        for action in ["approve", "revoke", "disable"] {
            let (_directory, state, workspace) = fixture().await;
            pending(&state);
            if action == "revoke" {
                approve_claim(
                    &state,
                    "claim",
                    json!({"role":"viewer","workspaces":[workspace]}),
                )
                .await
                .unwrap();
            }
            if action == "disable" {
                state
                    .workbench
                    .save_catalog("setting", "remote", json!({"id":"remote","enabled":true}))
                    .await
                    .unwrap();
            }
            state.workbench.close_storage_for_test().await;
            let error = match action {
                "approve" => approve_claim(
                    &state,
                    "claim",
                    json!({"role":"viewer","workspaces":[workspace]}),
                )
                .await
                .unwrap_err(),
                "revoke" => revoke_device(&state, "claim").await.unwrap_err(),
                _ => configure_remote(&state, json!({"enabled":false}))
                    .await
                    .unwrap_err(),
            };
            assert_eq!(error.kind, ErrorKind::StorageUnavailable);
            if action == "approve" {
                assert!(state.workbench.catalog("device").is_empty());
                assert!(state.remote.claims.lock().unwrap()["claim"].token.is_none());
            } else {
                assert!(state.remote.url().is_none());
                assert!(state.remote.claims.lock().unwrap().is_empty());
            }
            if action == "revoke" {
                assert_eq!(state.workbench.catalog("device")[0]["revoked"], false);
            }
            if action == "disable" {
                assert_eq!(
                    state
                        .workbench
                        .catalog("setting")
                        .into_iter()
                        .find(|record| record["id"] == "remote")
                        .unwrap()["enabled"],
                    true
                );
            }
            state.remote.stop().await;
            state.workbench.close().await;
        }
    }
    #[tokio::test]
    async fn failed_enable_persistence_removes_the_live_listener() {
        let (_directory, state, _workspace) = fixture().await;
        let reserved = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = reserved.local_addr().unwrap();
        drop(reserved);
        state.workbench.close_storage_for_test().await;
        let error = configure_remote(
            &state,
            json!({"enabled":true,"ip":"127.0.0.1","port":address.port()}),
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::StorageUnavailable);
        assert!(state.remote.url().is_none());
        assert!(state.workbench.catalog("setting").is_empty());
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match std::net::TcpListener::bind(address) {
                    Ok(listener) => {
                        drop(listener);
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
                        tokio::time::sleep(Duration::from_millis(10)).await
                    }
                    Err(error) => panic!("unexpected listener error: {error}"),
                }
            }
        })
        .await
        .expect("failed enable must release its TCP listener");
        state.workbench.close().await;
    }
    #[tokio::test]
    async fn expired_claim_cannot_write_a_device() {
        let (_directory, state, workspace) = fixture().await;
        pending(&state);
        state
            .remote
            .claims
            .lock()
            .unwrap()
            .get_mut("claim")
            .unwrap()
            .expires = now() - 1;
        assert_eq!(
            approve_claim(
                &state,
                "claim",
                json!({"role":"viewer","workspaces":[workspace]})
            )
            .await
            .unwrap_err()
            .kind,
            ErrorKind::PairingExpired
        );
        assert!(state.workbench.catalog("device").is_empty());
        state.remote.stop().await;
        state.workbench.close().await;
    }
}
