use super::*;
use crate::{
    contracts::ProviderProbeResponse,
    domain_error::{DomainError, ErrorKind},
};
use std::{process::Stdio, time::Duration};
use tokio::io::AsyncReadExt;

// Output is bounded and discarded after classification, never returned. The CLI is a fixed
// built-in status command, never shell text or a request-supplied executable.
struct StatusChild(tokio::process::Child);
impl Drop for StatusChild {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self
            .0
            .id()
            .and_then(|pid| rustix::process::Pid::from_raw(pid as i32))
        {
            let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
        }
        let _ = self.0.start_kill();
    }
}
async fn authentication(provider: &str) -> &'static str {
    let Some(program) = crate::providers::find_on_path(if provider == "codex" {
        "codex"
    } else {
        "claude"
    }) else {
        return "unknown";
    };
    let mut command = tokio::process::Command::new(program);
    command
        .args(if provider == "codex" {
            vec!["login", "status"]
        } else {
            vec!["auth", "status", "--json"]
        })
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let Ok(child) = command.spawn() else {
        return "unknown";
    };
    let mut child = StatusChild(child);
    let Some(stdout) = child.0.stdout.take() else {
        return "unknown";
    };
    let Some(stderr) = child.0.stderr.take() else {
        return "unknown";
    };
    let checked = tokio::time::timeout(Duration::from_secs(4), async {
        let (stdout, stderr) = tokio::join!(limited_output(stdout), limited_output(stderr));
        let (stdout, stderr) = (stdout?, stderr?);
        let status = child.0.wait().await.ok()?;
        Some(login_state(provider, status.success(), &stdout, &stderr))
    })
    .await;
    checked.ok().flatten().unwrap_or("unknown")
}
async fn limited_output(stream: impl tokio::io::AsyncRead + Unpin) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    stream.take(8193).read_to_end(&mut bytes).await.ok()?;
    (bytes.len() <= 8192).then_some(bytes)
}
fn login_state(provider: &str, success: bool, stdout: &[u8], stderr: &[u8]) -> &'static str {
    if provider == "codex" {
        if success {
            return "authenticated";
        }
        if [stdout, stderr].iter().any(|bytes| {
            std::str::from_utf8(bytes).is_ok_and(|text| text.trim() == "Not logged in")
        }) {
            return "not_authenticated";
        }
        return "unknown";
    }
    match serde_json::from_slice::<Value>(stdout)
        .ok()
        .and_then(|value| value["loggedIn"].as_bool())
    {
        Some(true) => "authenticated",
        Some(false) => "not_authenticated",
        None => "unknown",
    }
}

fn info(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| !text.is_empty())
        .map(|text| text.chars().filter(|c| !c.is_control()).take(120).collect())
}
impl Workbench {
    pub(crate) async fn probe_provider(
        &self,
        id: &str,
        profile_id: Option<&str>,
    ) -> Result<ProviderProbeResponse, DomainError> {
        self.available()
            .map_err(|_| DomainError::new(ErrorKind::HostUnavailable, "工作主机当前不可用"))?;
        let _gate = self.probe_gate.try_lock().map_err(|_| {
            DomainError::new(ErrorKind::ProbeBusy, "已有环境探测正在执行，请稍后重试")
        })?;
        let mut provider = self
            .providers
            .iter()
            .find(|provider| provider.id == id)
            .cloned()
            .ok_or_else(|| {
                DomainError::new(
                    ErrorKind::InvalidInput,
                    "此入口不支持独立探测，请通过会话连接验证",
                )
            })?;
        let profile = profile_id.map(|id| self.profile_view(id)).transpose()?;
        if profile
            .as_ref()
            .is_some_and(|profile| profile.provider != id)
        {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "配置与Agent不匹配",
            ));
        }
        let custom = profile.as_ref().is_some_and(|profile| {
            profile.details.command.is_some() || profile.details.args.is_some()
        });
        if let Some(profile) = &profile {
            if let Some(command) = &profile.details.command {
                provider.command = PathBuf::from(command);
            }
            if let Some(args) = &profile.details.args {
                provider.args = args.clone();
            }
        }
        let mut result = ProviderProbeResponse {
            provider: id.into(),
            profile_id: profile_id.map(str::to_owned),
            profile_revision: profile
                .as_ref()
                .and_then(|profile| profile.details.revision),
            state: "not_installed".into(),
            name: None,
            version: None,
            protocol_version: None,
            capabilities: json!({}),
            authentication: "unknown".into(),
            authentication_command: if custom {
                None
            } else {
                match id {
                    "codex" => Some("codex login".into()),
                    "claude" => Some("claude auth login".into()),
                    _ => None,
                }
            },
        };
        if (!custom && !provider.available) || !provider.command.is_file() {
            return Ok(result);
        }
        match vibeone_agent_client::probe(provider.command, provider.args).await {
            Ok(response) => {
                result.name = info(&response["info"]["name"]);
                result.version = info(&response["info"]["version"]);
                result.protocol_version = response["protocolVersion"].as_u64();
                let session = &response["capabilities"]["session"];
                result.state = if result.protocol_version == Some(2) && session.is_object() {
                    "ready"
                } else {
                    "incompatible"
                }
                .into();
                for (name, value) in [
                    ("session", session),
                    ("image", &session["prompt"]["image"]),
                    ("embeddedContext", &session["prompt"]["embeddedContext"]),
                ] {
                    result.capabilities[name] = json!(value.is_object() || value == true);
                }
                if result.state == "ready" {
                    result.authentication = if id == "demo" && !custom {
                        "not_required"
                    } else if !custom && matches!(id, "codex" | "claude") {
                        authentication(id).await
                    } else {
                        "unknown"
                    }
                    .into();
                }
            }
            Err(code) => {
                result.state = match code {
                    -32098 => "timed_out",
                    -32022 => "incompatible",
                    -32000 => "authentication_required",
                    _ => "failed",
                }
                .into();
                if code == -32000 {
                    result.authentication = "not_authenticated".into();
                }
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn login_status_does_not_confuse_cli_failures_with_missing_authentication() {
        assert_eq!(
            login_state("codex", false, b"", b"Not logged in\n"),
            "not_authenticated"
        );
        assert_eq!(
            login_state("codex", false, b"", b"network error"),
            "unknown"
        );
        assert_eq!(
            login_state("codex", true, b"", b"private key text"),
            "authenticated"
        );
        assert_eq!(
            login_state(
                "claude",
                false,
                br#"{"loggedIn":false,"email":"private"}"#,
                b""
            ),
            "not_authenticated"
        );
        assert_eq!(
            login_state("claude", false, b"invalid json", b"private"),
            "unknown"
        );
    }
}
