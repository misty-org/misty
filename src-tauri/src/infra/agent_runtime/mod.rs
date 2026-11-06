//! The agent runtime on this computer (docs/plans/desktop-runtime.md).
//!
//! Agents run here, not on the server. The app starts the runtime
//! (`src-tauri/services/agent-runtime`, built with nitro) as a helper process on loopback, gives it
//! this device's model keys and choices, and hands it the runs the server queues for this
//! device (`agent_runtime_deliver`). Every call to it is signed with a secret made for this
//! launch, so nothing else on the computer can drive it. Its runs are kept under
//! `~/.misty/runtime`, so a run continues after Misty quits and opens again.
pub mod calls;
pub mod live;

use std::{
    path::PathBuf,
    process::Stdio,
    sync::OnceLock,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;
use tauri::Manager;
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};

struct Running {
    base: String,
    secret: Vec<u8>,
    child: Child,
}

static RUNNING: Mutex<Option<Running>> = Mutex::const_new(None);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Settings the runtime would otherwise read from its environment. On this computer it works
/// only on the keys the app gives it, and keeps its runs in its local store.
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

/// Where the runtime's build is: `MISTY_AGENT_RUNTIME_ENTRY`, the app's resources, or in a
/// development build the checkout's `.output`.
fn entry(app: &tauri::AppHandle) -> Option<PathBuf> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("agent-runtime/server/index.mjs"));
    let checkout = cfg!(debug_assertions).then(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("services/agent-runtime/.output/server/index.mjs")
    });
    std::env::var_os("MISTY_AGENT_RUNTIME_ENTRY")
        .map(PathBuf::from)
        .into_iter()
        .chain(bundled)
        .chain(checkout)
        .find(|path| path.is_file())
}

/// The Node that runs it: `MISTY_AGENT_RUNTIME_NODE`, the one shipped beside the app, or one
/// installed on this computer. An app opened from the Dock has no shell PATH, so the usual
/// install folders are tried too.
fn node() -> PathBuf {
    let name = if cfg!(windows) {
        "misty-node.exe"
    } else {
        "misty-node"
    };
    let shipped = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(name)));
    std::env::var_os("MISTY_AGENT_RUNTIME_NODE")
        .map(PathBuf::from)
        .into_iter()
        .chain(shipped)
        .chain(["/opt/homebrew/bin/node", "/usr/local/bin/node"].map(PathBuf::from))
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from("node"))
}

async fn start(app: &tauri::AppHandle) -> Result<Running, String> {
    let entry = entry(app).ok_or("Misty's agent runtime isn't installed.")?;
    let home = crate::infra::paths::misty_home_dir()
        .ok_or("Misty's data folder is unavailable.")?
        .join("runtime");
    tokio::fs::create_dir_all(home.join("world"))
        .await
        .map_err(|_| "Misty couldn't create the agent runtime's folder.")?;
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map_err(|_| "No local port is free for the agent runtime.")?
        .port();
    let mut secret = vec![0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret);
    let log = std::fs::OpenOptions::new()
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
        .env("MISTY_RUNTIME_LIVE_TRANSCRIBE", "1")
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
    let mut child = command
        .spawn()
        .map_err(|_| "Misty couldn't start its agent runtime. Is Node installed?")?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return Err(
                "Misty's agent runtime stopped as it started. See ~/.misty/runtime/runtime.log."
                    .into(),
            );
        }
        if calls::healthy(&base).await {
            return Ok(Running {
                base,
                secret,
                child,
            });
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let _ = child.start_kill();
    Err("Misty's agent runtime didn't start in time.".into())
}

/// The running runtime's address and launch secret, starting it when it isn't running.
pub(crate) async fn ensure(app: &tauri::AppHandle) -> Result<(String, Vec<u8>), String> {
    let _ = APP.set(app.clone());
    let mut running = RUNNING.lock().await;
    if let Some(current) = running.as_mut() {
        if matches!(current.child.try_wait(), Ok(None)) {
            return Ok((current.base.clone(), current.secret.clone()));
        }
    }
    let started = start(app).await?;
    let address = (started.base.clone(), started.secret.clone());
    *running = Some(started);
    drop(running);
    // A run started before the runtime had the device's models would fail at once.
    push_models(app, &address).await?;
    Ok(address)
}

async fn push_models(
    app: &tauri::AppHandle,
    (base, secret): &(String, Vec<u8>),
) -> Result<(), String> {
    let document = crate::infra::models::current_document(app)
        .await
        .unwrap_or_else(|| serde_json::json!({}));
    let (status, _) = calls::post(base, secret, "/v1/local/models", "models", &document).await?;
    (200..300)
        .contains(&status)
        .then_some(())
        .ok_or_else(|| "Misty couldn't give its agent runtime this device's models.".into())
}

/// Gives the running runtime this device's new model choices and keys.
pub fn models_changed() {
    let Some(app) = APP.get().cloned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let address = {
            let mut running = RUNNING.lock().await;
            let Some(current) = running.as_mut() else {
                return;
            };
            if !matches!(current.child.try_wait(), Ok(None)) {
                return;
            }
            (current.base.clone(), current.secret.clone())
        };
        if let Err(error) = push_models(&app, &address).await {
            eprintln!("Could not give the agent runtime this device's models: {error}");
        }
    });
}

/// Stops the runtime with Misty. Its runs wait in its local store for the next launch.
pub fn stop() {
    if let Ok(mut running) = RUNNING.try_lock() {
        if let Some(current) = running.as_mut() {
            let _ = current.child.start_kill();
        }
        *running = None;
    }
}
