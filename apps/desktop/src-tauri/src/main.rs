#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod data;
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
    let mut connection: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
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
        connection["persistent"] = health["persistent"].clone();
        connection["dataDirectory"] = serde_json::json!(path.parent());
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
    launch_host(&app).await
}

fn session_busy(session: &Value) -> bool {
    matches!(
        session["status"].as_str(),
        Some("starting" | "running" | "requires_action" | "cancelling")
    ) || ["approvals", "inputs"].iter().any(|key| {
        session[*key]
            .as_array()
            .is_some_and(|items| !items.is_empty())
    })
}

async fn launch_host(app: &tauri::AppHandle) -> Result<Value, String> {
    let mut data = data::target()?;
    let mut migration_warning = None;
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    if !data.exists() && legacy.is_dir() && legacy != data {
        if let Some(mut connection) = healthy(&legacy.join("host.json")).await {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
                .map_err(|error| error.to_string())?;
            let url = connection["url"].as_str().ok_or("主机地址无效")?.to_owned();
            let token = connection["token"]
                .as_str()
                .ok_or("主机凭证无效")?
                .to_owned();
            let snapshot: Value = client
                .get(format!("{url}/v1/snapshot"))
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|error| error.to_string())?
                .error_for_status()
                .map_err(|error| error.to_string())?
                .json()
                .await
                .map_err(|error| error.to_string())?;
            if snapshot["sessions"]
                .as_array()
                .is_none_or(|sessions| sessions.iter().any(session_busy))
            {
                connection["migrationPending"] = Value::Bool(true);
                return Ok(connection);
            }
            if snapshot["persistent"] != true {
                save_legacy(&legacy, &snapshot)?;
            }
            client
                .post(format!("{url}/v1/host/stop"))
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|error| error.to_string())?
                .error_for_status()
                .map_err(|error| error.to_string())?;
            for _ in 0..100 {
                if !legacy.join("host.json").exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if legacy.join("host.json").exists() {
                return Err("旧主机尚未退出，原数据尚未迁移".into());
            }
        }
        if let Err(error) = data::migrate(&legacy, &data) {
            if !legacy.is_dir() {
                return Err(error);
            }
            migration_warning = Some(error);
            data = legacy;
        }
    }
    std::fs::create_dir_all(&data).map_err(|error| error.to_string())?;
    let record = data.join("host.json");
    if let Some(mut connection) = healthy(&record).await {
        connection["migrationWarning"] = serde_json::json!(migration_warning);
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
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let mut command = Command::new(binary);
    if resources
        .join("runtime/plugin-runtime/dist/main.js")
        .is_file()
    {
        command.env("VIBEONE_RUNTIME_DIR", resources.join("runtime"));
    }
    if resources.join("web/index.html").is_file() {
        command.env("VIBEONE_WEB_DIR", resources.join("web"));
    }
    if resources
        .join("examples/workspace-tools/plugin.json")
        .is_file()
    {
        command.env(
            "VIBEONE_EXAMPLE_PLUGIN",
            resources.join("examples/workspace-tools"),
        );
    }
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
        if let Some(mut connection) = healthy(&record).await {
            connection["migrationWarning"] = serde_json::json!(migration_warning);
            return Ok(connection);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("Host 启动超时，请查看应用数据目录中的 host.log".into())
}

// Export before stopping the old in-memory Host. A failed export leaves it running.
fn save_legacy(data: &Path, snapshot: &Value) -> Result<(), String> {
    use std::io::Write;
    let temporary = data.join(format!("legacy-snapshot.{}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(&serde_json::to_vec(snapshot).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        std::fs::rename(&temporary, data.join("legacy-snapshot.json"))
            .map_err(|error| error.to_string())?;
        std::fs::File::open(data)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

#[tauri::command]
async fn restart_host(
    app: tauri::AppHandle,
    launcher: State<'_, Launcher>,
) -> Result<Value, String> {
    let _gate = launcher.0.lock().await;
    let data = data::current(&app)?;
    let record = data.join("host.json");
    if let Some(connection) = healthy(&record).await {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|error| error.to_string())?;
        let url = connection["url"].as_str().ok_or("主机地址无效")?;
        let token = connection["token"].as_str().ok_or("主机凭证无效")?;
        let snapshot: Value = client
            .get(format!("{url}/v1/snapshot"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;
        let sessions = snapshot["sessions"].as_array().ok_or("主机会话格式无效")?;
        if sessions.iter().any(session_busy) {
            return Err("请先完成或停止所有执行并处理审批、补充输入，再重启主机".into());
        }
        if snapshot["persistent"] != true {
            save_legacy(&data, &snapshot)?;
        }
        client
            .post(format!("{url}/v1/host/stop"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?;
        // Host keeps its instance lock until ACP children and SQLite have closed.
        for _ in 0..100 {
            if !record.exists() {
                return launch_host(&app).await;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        return Err("主机尚未退出，请稍后重新连接；会话导出已保留".into());
    }
    launch_host(&app).await
}

#[tauri::command]
async fn export_remote_certificate(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let source = data::current(&app)?.join("VibeOne-Root-CA.crt");
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name("VibeOne-Root-CA.crt")
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|error| error.to_string())?;
        std::fs::copy(source, &path).map_err(|error| error.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
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
        .plugin(tauri_plugin_notification::init())
        .manage(Launcher::default())
        .setup(|app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            let open = MenuItem::with_id(app, "open", "打开 VibeOne", true, None::<&str>)?;
            let quit =
                MenuItem::with_id(app, "quit", "退出桌面（主机继续运行）", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "停止所有执行并退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit, &stop])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("VibeOne")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    "stop" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Ok(data) = data::current(&app)
                                && let Some(connection) = healthy(&data.join("host.json")).await
                                && let (Some(url), Some(token)) =
                                    (connection["url"].as_str(), connection["token"].as_str())
                            {
                                let _ = reqwest::Client::new()
                                    .post(format!("{url}/v1/host/stop"))
                                    .bearer_auth(token)
                                    .send()
                                    .await;
                            }
                            app.exit(0);
                        });
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            host_connection,
            restart_host,
            choose_workspace,
            export_remote_certificate
        ])
        .build(tauri::generate_context!())
        .expect("VibeOne 桌面应用启动失败")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. })
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.show();
                let _ = window.set_focus();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrade_export_is_durable_and_failed_replacement_preserves_previous_export() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("vibeone-upgrade-{}-{unique}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let snapshot = serde_json::json!({"sessions":[{"id":"retained"}]});
        save_legacy(&directory, &snapshot).unwrap();
        let file = directory.join("legacy-snapshot.json");
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&file).unwrap()).unwrap(),
            snapshot
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::create_dir(directory.join(format!("legacy-snapshot.{}.tmp", std::process::id())))
            .unwrap();
        assert!(save_legacy(&directory, &serde_json::json!({"sessions":[]})).is_err());
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&file).unwrap()).unwrap(),
            snapshot
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
