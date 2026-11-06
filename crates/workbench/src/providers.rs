use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub description: String,
    #[serde(skip)]
    pub command: PathBuf,
    #[serde(skip)]
    pub args: Vec<String>,
}

pub fn find_node() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("VIBEONE_NODE")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
    {
        return Some(path);
    }
    if let Some(path) = find_on_path("node") {
        return Some(path);
    }
    let home = PathBuf::from(std::env::var_os("HOME")?);
    let mut versions: Vec<_> = std::fs::read_dir(home.join(".nvm/versions/node"))
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .collect();
    versions.sort_by_cached_key(|path| {
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .trim_start_matches('v')
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    });
    versions
        .into_iter()
        .rev()
        .map(|path| path.join("bin/node"))
        .find(|path| path.is_file())
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|path| {
            path.join(if cfg!(windows) {
                format!("{name}.exe")
            } else {
                name.into()
            })
        })
        .find(|path| path.is_file())
}

pub fn providers(data_dir: &Path) -> Vec<Provider> {
    let node = find_node();
    let mut result = vec![Provider {
        id: "demo".into(),
        name: "本地演示".into(),
        available: node.is_some(),
        description: "不调用模型。可体验流式消息、审批和取消。".into(),
        command: node.clone().unwrap_or_default(),
        args: vec![
            data_dir
                .join("demo-agent.mjs")
                .to_string_lossy()
                .into_owned(),
        ],
    }];
    let root = std::env::var_os("VIBEONE_BRIDGES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../node_modules/.bin"));
    for (id, name, binary, version) in [
        ("codex", "Codex", "codex-acp", "2.5.0"),
        ("claude", "Claude Code", "claude-agent-acp", "0.101.0"),
    ] {
        let script = root.join(binary);
        let global = find_on_path(binary);
        let (command, args, available) = if script.is_file() {
            (
                node.clone().unwrap_or_default(),
                vec![script.to_string_lossy().into_owned()],
                node.is_some(),
            )
        } else if let Some(path) = global {
            (path, vec![], true)
        } else {
            (PathBuf::new(), vec![], false)
        };
        result.push(Provider {
            id: id.into(),
            name: name.into(),
            available,
            description: format!("ACP v2 · 桥接器 {version} · 使用本机已有认证"),
            command,
            args,
        });
    }
    result
}
