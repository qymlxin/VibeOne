use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{State, ipc::Channel};

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Data { data: Vec<u8> },
    Exit { code: Option<u32> },
}
struct TerminalHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}
impl Drop for TerminalHandle {
    fn drop(&mut self) {
        let _ = self.killer.kill();
    }
}
#[derive(Default)]
pub struct Terminals(Mutex<HashMap<String, Arc<Mutex<TerminalHandle>>>>);
impl Terminals {
    pub fn close_all(&self) {
        if let Ok(mut entries) = self.0.lock() {
            entries.clear();
        }
    }
}
fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(2, 500),
        rows: rows.clamp(1, 300),
        pixel_width: 0,
        pixel_height: 0,
    }
}
pub fn local(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("仅主工作台可以操作本机工具".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn terminal_open(
    webview: tauri::Webview,
    terminals: State<'_, Terminals>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    events: Channel<TerminalEvent>,
) -> Result<String, String> {
    local(&webview)?;
    if id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("终端标识无效".into());
    }
    let cwd = PathBuf::from(cwd)
        .canonicalize()
        .map_err(|e| format!("工作目录不可用：{e}"))?;
    if !cwd.is_dir() {
        return Err("请选择工作目录".into());
    }
    let mut entries = terminals.0.lock().map_err(|e| e.to_string())?;
    if entries.contains_key(&id) {
        return Err("终端已经打开".into());
    }
    if entries.len() >= 16 {
        return Err("最多同时打开16个终端，请先关闭不用的标签".into());
    }
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) {
            "powershell.exe".into()
        } else {
            "/bin/zsh".into()
        }
    });
    let mut cmd = CommandBuilder::new(&shell);
    if !cfg!(windows) {
        cmd.args(["-l", "-i"]);
    }
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    drop(pair.slave);
    entries.insert(
        id,
        Arc::new(Mutex::new(TerminalHandle {
            master: pair.master,
            writer,
            killer,
        })),
    );
    std::thread::spawn(move || {
        let mut buffer = [0; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if events
                        .send(TerminalEvent::Data {
                            data: buffer[..n].to_vec(),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        let code = child.wait().ok().map(|status| status.exit_code());
        let _ = events.send(TerminalEvent::Exit { code });
    });
    Ok(format!(
        "{} · {}",
        std::env::var("USER").unwrap_or_else(|_| "Shell".into()),
        PathBuf::from(shell)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ))
}
#[tauri::command]
pub async fn terminal_write(
    webview: tauri::Webview,
    terminals: State<'_, Terminals>,
    id: String,
    data: String,
) -> Result<(), String> {
    local(&webview)?;
    if data.len() > 65536 {
        return Err("单次输入过长".into());
    }
    let entry = terminals
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .cloned()
        .ok_or("终端已关闭")?;
    let mut terminal = entry.lock().map_err(|e| e.to_string())?;
    terminal
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| terminal.writer.flush())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn terminal_resize(
    webview: tauri::Webview,
    terminals: State<'_, Terminals>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    local(&webview)?;
    let entry = terminals
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .cloned()
        .ok_or("终端已关闭")?;
    entry
        .lock()
        .map_err(|e| e.to_string())?
        .master
        .resize(size(cols, rows))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn terminal_close(
    webview: tauri::Webview,
    terminals: State<'_, Terminals>,
    id: String,
) -> Result<(), String> {
    local(&webview)?;
    terminals.0.lock().map_err(|e| e.to_string())?.remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_pty_accepts_input_and_resizes() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "read value; printf 'PTY:%s\\n' \"$value\""]);
        cmd.cwd(std::env::temp_dir());
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        pair.master.resize(size(100, 30)).unwrap();
        assert_eq!(pair.master.get_size().unwrap().cols, 100);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"working\n").unwrap();
        writer.flush().unwrap();
        let mut output = Vec::new();
        let _ = reader.read_to_end(&mut output);
        assert!(String::from_utf8_lossy(&output).contains("PTY:working"));
        assert_eq!(child.wait().unwrap().exit_code(), 0);
    }
}
