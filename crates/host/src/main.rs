mod workspace;

use serde_json::json;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use vibeone_plugin_host::{Activation, Error, InstanceGrant, InstanceKey, PluginHost, Result};
use workspace::WorkspaceBroker;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() == 3 && args[0] == "serve" && args[1] == "--data-dir" {
        return vibeone_workbench::serve(PathBuf::from(&args[2]))
            .await
            .map_err(|error| Error::Invalid(error.to_string()));
    }
    if args.is_empty() || args[0] == "--help" {
        println!(
            "VibeOne Host (P0)\n\n  vibeone-host serve --data-dir <directory>\n  vibeone-host plugin scan --workspace <directory>\n\nserve starts the authenticated local ACP v2 workbench; plugin scan runs Rust → Node → Rust."
        );
        return Ok(());
    }
    if args.len() != 4 || args[0] != "plugin" || args[1] != "scan" || args[2] != "--workspace" {
        return Err(Error::Invalid(
            "usage: vibeone-host plugin scan --workspace <directory>".into(),
        ));
    }
    let workspace = PathBuf::from(&args[3]).canonicalize()?;
    if !workspace.is_dir() {
        return Err(Error::Invalid("workspace must be a directory".into()));
    }
    let project = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let runner = project.join("packages/plugin-runtime/dist/main.js");
    if !runner.is_file() {
        return Err(Error::Invalid("run npm ci && npm run build first".into()));
    }
    let node = std::env::var_os("VIBEONE_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| "node".into());
    let host = PluginHost::spawn(
        &node,
        &runner,
        Arc::new(WorkspaceBroker::new("local", workspace)?),
    )
    .await?;
    let mut progress = host.subscribe();
    let logging = tokio::spawn(async move {
        while let Ok(event) = progress.recv().await {
            eprintln!("{}", event["value"]);
        }
    });
    let key = InstanceKey {
        instance_id: "workspace-tools:local".into(),
        generation: 1,
    };
    let result = async {
        host.activate(Activation {
            package_path: project.join("examples/plugins/workspace-tools"),
            grant: InstanceGrant {
                key: key.clone(),
                plugin_id: "dev.vibeone.workspace-tools".into(),
                capabilities: HashSet::from(["workspace.read".into()]),
                workspaces: HashSet::from(["local".into()]),
            },
            config: json!({}),
        })
        .await?;
        host.invoke(
            &key,
            "workspace.scan",
            json!({"path": "."}),
            Some("local"),
            Duration::from_secs(10),
        )
        .await
    }
    .await;
    let shutdown = host.shutdown().await;
    logging.abort();
    println!("{}", serde_json::to_string_pretty(&result?)?);
    shutdown
}
