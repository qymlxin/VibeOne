use crate::terminal::local;
use serde::{Deserialize, Serialize};
use tauri::{
    LogicalPosition, LogicalSize, Manager, WebviewUrl,
    ipc::Channel,
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
};
#[derive(Clone, Serialize)]
pub struct BrowserEvent {
    state: String,
    url: String,
}
#[derive(Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
fn label(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("网页标识无效".into());
    }
    Ok(format!("browser-{id}"))
}
fn url(value: &str) -> Result<tauri::Url, String> {
    let u = tauri::Url::parse(value).map_err(|_| "网址无效")?;
    if !matches!(u.scheme(), "https" | "http") || !u.username().is_empty() || u.password().is_some()
    {
        return Err("仅支持HTTP/HTTPS网址".into());
    }
    Ok(u)
}
fn geometry(bounds: &Bounds) -> Result<(), String> {
    if ![bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.0 && *v < 20000.0)
        || bounds.width < 1.0
        || bounds.height < 1.0
    {
        return Err("网页区域无效".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn browser_open(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    address: String,
    bounds: Bounds,
    events: Channel<BrowserEvent>,
) -> Result<(), String> {
    local(&webview)?;
    geometry(&bounds)?;
    let label = label(&id)?;
    let address = url(&address)?;
    if app.get_webview(&label).is_some() {
        return Err("网页已经打开".into());
    }
    if app
        .webviews()
        .keys()
        .filter(|key| key.starts_with("browser-"))
        .count()
        >= 16
    {
        return Err("最多同时打开16个网页".into());
    }
    let navigate_events = events.clone();
    let popup_app = app.clone();
    let popup_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(address))
        .on_navigation(move |u| {
            if url(u.as_str()).is_err() {
                return false;
            }
            let _ = navigate_events.send(BrowserEvent {
                state: "loading".into(),
                url: u.to_string(),
            });
            true
        })
        .on_new_window(move |address, _| {
            if url(address.as_str()).is_ok() {
                if let Some(view) = popup_app.get_webview(&popup_label) {
                    let _ = view.navigate(address);
                }
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            let _ = events.send(BrowserEvent {
                state: match payload.event() {
                    PageLoadEvent::Started => "loading",
                    PageLoadEvent::Finished => "loaded",
                }
                .into(),
                url: payload.url().to_string(),
            });
        });
    app.get_window("main")
        .ok_or("主窗口不可用")?
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn browser_layout(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    bounds: Bounds,
    visible: bool,
) -> Result<(), String> {
    local(&webview)?;
    let Some(view) = app.get_webview(&label(&id)?) else {
        return Ok(());
    };
    if visible {
        geometry(&bounds)?;
        view.set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
        view.set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
        view.show().map_err(|e| e.to_string())
    } else {
        view.hide().map_err(|e| e.to_string())
    }
}
#[tauri::command]
pub async fn browser_action(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    action: String,
    address: Option<String>,
) -> Result<(), String> {
    local(&webview)?;
    let view = app.get_webview(&label(&id)?).ok_or("网页尚未打开")?;
    match action.as_str() {
        "navigate" => view.navigate(url(address.as_deref().unwrap_or(""))?),
        "reload" => view.reload(),
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "close" => view.close(),
        _ => return Err("网页操作无效".into()),
    }
    .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_urls_cannot_be_app_pages() {
        for value in [
            "tauri://localhost",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://user:pass@example.com",
        ] {
            assert!(url(value).is_err());
        }
        assert!(url("https://www.baidu.com").is_ok());
    }
}
