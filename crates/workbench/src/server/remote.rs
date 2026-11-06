use super::*;
use axum::extract::ConnectInfo;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    path::Path as FsPath,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

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
    url: String,
    handle: axum_server::Handle<SocketAddr>,
}
pub(super) struct Remote {
    directory: PathBuf,
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
    pub fn stop(&self) {
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
    pub async fn start(&self, state: Server, ip: IpAddr, port: u16) -> Result<Value, String> {
        let _gate = self.gate.lock().await;
        if self.url().is_some() {
            return Err("远程入口已开启，请先关闭再修改地址".into());
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
            return Err("请选择本机局域网或可信网络地址，不允许通配或公网地址".into());
        }
        let tls_path = self.directory.join("remote-tls.json");
        let saved = std::fs::read(&tls_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .filter(|value| value["ip"] == ip.to_string());
        let tls = match saved {
            Some(value) => value,
            None => certificate(ip)?,
        };
        write_private(
            &tls_path,
            &serde_json::to_vec(&tls).map_err(|error| error.to_string())?,
        )?;
        std::fs::write(
            self.directory.join("VibeOne-Root-CA.crt"),
            tls["ca"].as_str().ok_or("CA 证书无效")?,
        )
        .map_err(|error| error.to_string())?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let config = axum_server::tls_rustls::RustlsConfig::from_pem(
            tls["chain"].as_str().ok_or("证书无效")?.as_bytes().to_vec(),
            tls["key"]
                .as_str()
                .ok_or("证书密钥无效")?
                .as_bytes()
                .to_vec(),
        )
        .await
        .map_err(|error| error.to_string())?;
        let listener = std::net::TcpListener::bind(SocketAddr::new(ip, port))
            .map_err(|error| error.to_string())?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let address = listener.local_addr().map_err(|error| error.to_string())?;
        let url = format!("https://{address}");
        let handle = axum_server::Handle::new();
        let remote_state = Server {
            is_remote: true,
            ..state.clone()
        };
        let web = std::env::var_os("VIBEONE_WEB_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                FsPath::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/dist")
            });
        if !web.join("index.html").is_file() {
            return Err("手机页面未构建，请先运行 npm run build:web -w @vibeone/desktop".into());
        }
        let app = routes(remote_state).fallback_service(
            tower_http::services::ServeDir::new(&web)
                .not_found_service(tower_http::services::ServeFile::new(web.join("index.html"))),
        );
        let server = axum_server::from_tcp_rustls(listener, config)
            .map_err(|error| error.to_string())?
            .handle(handle.clone())
            .serve(app.into_make_service_with_connect_info::<SocketAddr>());
        let mut stopped = state.stop.subscribe();
        let shutdown = handle.clone();
        tokio::spawn(async move {
            tokio::select! {result=server=>{if let Err(error)=result{eprintln!("remote listener stopped: {error}");}},_=stopped.changed()=>shutdown.shutdown()}
        });
        *self.running.lock().expect("remote poisoned") = Some(Running {
            url: url.clone(),
            handle,
        });
        let code = qrcode::QrCode::new(url.as_bytes())
            .map_err(|error| error.to_string())?
            .render::<qrcode::render::svg::Color>()
            .min_dimensions(200, 200)
            .build();
        Ok(
            json!({"url":url,"qr":code,"certificatePath":self.directory.join("VibeOne-Root-CA.crt")}),
        )
    }
}
fn write_private(path: &FsPath, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}
fn certificate(ip: IpAddr) -> Result<Value, String> {
    use rcgen::{
        BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer,
        KeyPair, KeyUsagePurpose,
    };
    let mut ca = CertificateParams::new(Vec::<String>::new()).map_err(|error| error.to_string())?;
    ca.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca.distinguished_name
        .push(DnType::CommonName, "VibeOne Local Root");
    ca.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    ca.not_before = time::OffsetDateTime::now_utc() - time::Duration::days(1);
    ca.not_after = time::OffsetDateTime::now_utc() + time::Duration::days(3650);
    let key = KeyPair::generate().map_err(|error| error.to_string())?;
    let root = ca.self_signed(&key).map_err(|error| error.to_string())?;
    let issuer = Issuer::new(ca, key);
    let mut leaf =
        CertificateParams::new(vec![ip.to_string()]).map_err(|error| error.to_string())?;
    leaf.distinguished_name
        .push(DnType::CommonName, "VibeOne Host");
    leaf.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    leaf.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    leaf.not_before = time::OffsetDateTime::now_utc() - time::Duration::days(1);
    leaf.not_after = time::OffsetDateTime::now_utc() + time::Duration::days(730);
    let key = KeyPair::generate().map_err(|error| error.to_string())?;
    let cert = leaf
        .signed_by(&key, &issuer)
        .map_err(|error| error.to_string())?;
    Ok(
        json!({"ip":ip.to_string(),"ca":root.pem(),"chain":format!("{}{}",cert.pem(),root.pem()),"key":key.serialize_pem()}),
    )
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
pub(super) fn filter_snapshot(mut snapshot: Value, identity: &Identity) -> Value {
    if identity.device.is_none() {
        return snapshot;
    }
    let workspaces = snapshot["workspaces"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let visible: Vec<_> = workspaces
        .into_iter()
        .filter(|workspace| identity.allowed(workspace["id"].as_str().unwrap_or_default(), "read"))
        .collect();
    let paths: Vec<_> = visible
        .iter()
        .filter_map(|workspace| workspace["path"].as_str())
        .collect();
    snapshot["sessions"] = json!(
        snapshot["sessions"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter(|session| paths.contains(&session["workspace"].as_str().unwrap_or_default()))
            .cloned()
            .map(|mut session| {
                if let Some(profile) = session["profile"].as_object_mut() {
                    profile.remove("command");
                    profile.remove("args");
                }
                session
            })
            .collect::<Vec<_>>()
    );
    snapshot["workspaces"] = json!(visible);
    if snapshot["storageError"].is_string() {
        snapshot["storageError"] = json!("主机本地存储不可用，请在电脑检查诊断");
    }
    snapshot["examplePluginPath"] = Value::Null;
    snapshot["pluginEvents"] = json!([]);
    snapshot["plugins"] = json!([]);
    snapshot["notifications"] = json!([]);
    snapshot["operations"] = json!([]);
    if let Some(profiles) = snapshot["profiles"].as_array_mut() {
        for profile in profiles {
            if let Some(profile) = profile.as_object_mut() {
                profile.remove("command");
                profile.remove("args");
            }
        }
    }
    snapshot["device"] = json!({"id":identity.device.as_ref().unwrap()["id"],"role":identity.device.as_ref().unwrap()["role"]});
    snapshot
}

pub(super) async fn configure(State(state): State<Server>, Json(body): Json<Value>) -> ApiResult {
    if body["enabled"] == false {
        state.remote.stop();
        state
            .workbench
            .put_catalog("setting", "remote", json!({"id":"remote","enabled":false}))
            .await
            .map_err(fail)?;
        return Ok(Json(json!({"enabled":false})));
    }
    let ip: IpAddr = body["ip"]
        .as_str()
        .ok_or_else(|| fail("请输入本机局域网 IP"))?
        .parse()
        .map_err(|_| fail("IP 地址无效"))?;
    let port = body["port"].as_u64().unwrap_or(0);
    if port > 65535 {
        return Err(fail("端口无效"));
    }
    let status = state
        .remote
        .start(state.clone(), ip, port as u16)
        .await
        .map_err(fail)?;
    let actual = reqwest_free_port(&status["url"])?;
    state
        .workbench
        .put_catalog(
            "setting",
            "remote",
            json!({"id":"remote","enabled":true,"ip":ip.to_string(),"port":actual}),
        )
        .await
        .map_err(fail)?;
    Ok(Json(status))
}
fn reqwest_free_port(url: &Value) -> Result<u16, (StatusCode, Json<Value>)> {
    url.as_str()
        .and_then(|url| url.rsplit(':').next())
        .and_then(|port| port.parse().ok())
        .ok_or_else(|| fail("监听地址无效"))
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
    if state.remote.url().is_none() {
        return Err(fail("请先开启 HTTPS 远程入口"));
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
    if !state.remote.attempts(address.ip()) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"配对尝试过多，请稍后重试"})),
        ));
    }
    let name = body["name"].as_str().unwrap_or("手机").trim();
    let claim_secret = body["secret"]
        .as_str()
        .ok_or_else(|| fail("设备请求缺少凭据"))?;
    if name.is_empty()
        || name.chars().count() > 80
        || claim_secret.len() < 32
        || claim_secret.len() > 128
    {
        return Err(fail("设备名称或请求无效"));
    }
    {
        let mut code = state.remote.code.lock().expect("pairing poisoned");
        if !code
            .as_ref()
            .is_some_and(|(code, expires)| body["code"] == *code && *expires > now())
        {
            return Err(fail("配对码无效或已过期"));
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
    let _gate = state.remote.gate.lock().await;
    if body["deny"] == true {
        if let Some(claim) = state
            .remote
            .claims
            .lock()
            .expect("pairing poisoned")
            .get_mut(&id)
        {
            claim.denied = true;
        }
        return Ok(Json(json!({"denied":true})));
    }
    let role = body["role"]
        .as_str()
        .ok_or_else(|| fail("请选择设备权限"))?;
    if !matches!(role, "viewer" | "operator" | "approver") {
        return Err(fail("设备角色无效"));
    }
    let workspaces = body["workspaces"]
        .as_array()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| fail("请至少授权一个工作区"))?;
    let known = state.workbench.snapshot()["workspaces"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if !workspaces
        .iter()
        .all(|id| known.iter().any(|workspace| workspace["id"] == *id))
    {
        return Err(fail("工作区授权无效"));
    }
    let (name, claim_hash) = {
        let claims = state.remote.claims.lock().expect("pairing poisoned");
        let claim = claims
            .get(&id)
            .filter(|claim| claim.expires > now() && !claim.denied && claim.token.is_none())
            .ok_or_else(|| fail("配对请求已失效"))?;
        (claim.name.clone(), claim.hash.clone())
    };
    let token = secret();
    let device = json!({"id":id,"name":name,"role":role,"workspaces":workspaces,"tokenHash":hash(&token),"createdAt":now(),"expiresAt":now()+90*86400,"revoked":false});
    state
        .workbench
        .put_catalog("device", &id, device)
        .await
        .map_err(fail)?;
    let mut claims = state.remote.claims.lock().expect("pairing poisoned");
    let claim = claims
        .get_mut(&id)
        .filter(|claim| claim.hash == claim_hash)
        .ok_or_else(|| fail("配对请求已失效"))?;
    claim.token = Some(token);
    Ok(Json(json!({"approved":true})))
}
pub(super) async fn poll(State(state): State<Server>, Json(body): Json<Value>) -> Response {
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
        return fail("配对请求无效或已过期").into_response();
    };
    if claim.denied {
        return Json(json!({"status":"denied"})).into_response();
    }
    if let Some(token) = claim.token.as_ref() {
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
    let mut device = state
        .workbench
        .catalog("device")
        .into_iter()
        .find(|device| device["id"] == id)
        .ok_or_else(|| fail("设备不存在"))?;
    device["revoked"] = json!(true);
    state
        .workbench
        .put_catalog("device", &id, device)
        .await
        .map_err(fail)?;
    Ok(Json(json!({"revoked":true})))
}
