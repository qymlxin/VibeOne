#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::Value;
use std::{
    fs::OpenOptions,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Launcher(tokio::sync::Mutex<()>);

async fn healthy(path: &Path) -> Option<Value> {
    let connection: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let url = connection["url"].as_str()?;
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "http" || parsed.host_str() != Some("127.0.0.1") {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .ok()?;
    let health: Value = client
        .get(format!("{url}/v1/health"))
        .bearer_auth(connection["token"].as_str()?)
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    if health["name"] == "vibeone-host" && health["protocolVersion"] == 2 {
        Some(connection)
    } else {
        None
    }
}

#[tauri::command]
async fn host_connection(
    app: tauri::AppHandle,
    launcher: State<'_, Launcher>,
) -> Result<Value, String> {
    let _gate = launcher.0.lock().await;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&data).map_err(|error| error.to_string())?;
    let record = data.join("host.json");
    if let Some(connection) = healthy(&record).await {
        return Ok(connection);
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("bin/vibeone-host");
    let binary = std::env::var_os("VIBEONE_HOST_BIN")
        .map(PathBuf::from)
        .or_else(|| resource.is_file().then_some(resource))
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("bin/vibeone-host"));
    if !binary.is_file() {
        return Err("未找到 Host，请使用 npm run desktop 构建并启动".into());
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let log = options
        .open(data.join("host.log"))
        .map_err(|error| error.to_string())?;
    let mut command = Command::new(binary);
    command
        .args(["serve", "--data-dir"])
        .arg(&data)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .spawn()
        .map_err(|error| format!("Host 启动失败：{error}"))?;
    for _ in 0..100 {
        if let Some(connection) = healthy(&record).await {
            return Ok(connection);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("Host 启动超时，请查看应用数据目录中的 host.log".into())
}

#[tauri::command]
async fn choose_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|folder| {
                folder
                    .into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Launcher::default())
        .invoke_handler(tauri::generate_handler![host_connection, choose_workspace])
        .run(tauri::generate_context!())
        .expect("VibeOne 桌面应用启动失败");
}
