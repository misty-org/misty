//! Starting the TypeScript runtime under Node, from the checkout. Part of the baseline this folder is
//! for: delete it with the rest.
use std::{
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;
use tokio::process::{Child, Command};

use crate::infra::file_access::{self, fs, fs_async};

pub(super) struct Running {
    pub(super) base: String,
    pub(super) secret: Vec<u8>,
    pub(super) child: Child,
}

/// Settings it would otherwise read from its environment. It works only on the keys the app gives it,
/// and keeps its runs in its local store.
const INHERITED: [&str; 18] = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "OPENROUTER_API_KEY",
    "AI_GATEWAY_API_KEY",
    "VERCEL_OIDC_TOKEN",
    "NVIDIA_API_KEY",
    "OLLAMA_API_KEY",
    "OPENAI_COMPATIBLE_API_KEY",
    "ELEVENLABS_API_KEY",
    "SONIOX_API_KEY",
    "MISTY_AGENT_MODEL",
    "MISTY_AGENT_RUNTIME_CONTROL_SECRET_PREVIOUS",
    "MISTY_INTERNAL_API_BASE",
    "WORKFLOW_TARGET_WORLD",
    "WORKFLOW_POSTGRES_URL",
];

fn entry() -> Option<PathBuf> {
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("services/agent-runtime/.output/server/index.mjs");
    file_access::looks::program_is_installed(&checkout).then_some(checkout)
}

/// An app opened from the Dock has no shell PATH, so the usual install folders are tried too.
fn node() -> PathBuf {
    ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
        .map(PathBuf::from)
        .into_iter()
        .find(|path| file_access::looks::program_is_installed(path))
        .unwrap_or_else(|| PathBuf::from("node"))
}

pub(super) async fn start() -> Result<Running, String> {
    let entry = entry().ok_or(
        "Build the TypeScript runtime first: npm run build in src-tauri/services/agent-runtime.",
    )?;
    let home = super::super::data_dir().ok_or("Misty's data folder is unavailable.")?;
    fs_async::create_dir_all(home.join("world"))
        .await
        .map_err(|_| "Misty couldn't create the agent runtime's folder.")?;
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map_err(|_| "No local port is free for the agent runtime.")?
        .port();
    let mut secret = vec![0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret);
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(home.join("runtime.log"))
        .map_err(|_| "Misty couldn't open the agent runtime's log.")?;
    let base = format!("http://127.0.0.1:{port}");
    let mut command = Command::new(node());
    command
        .arg(&entry)
        .env("PORT", port.to_string())
        .env("NITRO_PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("NITRO_HOST", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("MISTY_RUNTIME_DESKTOP", "1")
        .env(
            "MISTY_AGENT_RUNTIME_CONTROL_SECRET",
            STANDARD.encode(&secret),
        )
        .env("WORKFLOW_LOCAL_DATA_DIR", home.join("world"))
        .env("WORKFLOW_LOCAL_BASE_URL", &base)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|error| error.to_string())?)
        .stderr(log)
        .kill_on_drop(true);
    if let Some(dir) = entry.parent() {
        command.current_dir(dir);
    }
    for name in INHERITED {
        command.env_remove(name);
    }
    let mut child = command.spawn().map_err(|_| "Misty couldn't start Node.")?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return Err("The TypeScript runtime stopped as it started. See its log.".into());
        }
        let healthy = super::client()
            .get(format!("{base}/health"))
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .is_ok_and(|response| response.status().is_success());
        if healthy {
            return Ok(Running {
                base,
                secret,
                child,
            });
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let _ = child.start_kill();
    Err("The TypeScript runtime didn't start in time.".into())
}
