#[cfg(panic = "abort")]
compile_error!(
    "Misty needs panics to unwind: with panic=abort, one failed agent run closes the whole browser."
);

pub(crate) mod browser_log;
pub mod calls;
pub mod engine_modes;
pub mod host_lookup;
pub mod local_runs;
pub mod local_tools;
mod log;
pub(crate) mod run_ledger;
pub mod run_notices;
pub(crate) mod run_steps;
pub(crate) mod run_taint;
pub(crate) mod step_pictures;
mod system_speech;
pub(crate) mod take_over;
pub(crate) mod tool_gate;
pub(crate) mod tool_journal;
pub(crate) mod tool_policy;
pub(crate) mod tool_question;
pub(crate) mod turn_rewind;
mod turn_snapshots;
mod untrusted;
pub(crate) mod windows;

use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, PoisonError,
    },
    time::Duration,
};

use agent_runs::{runtime_client_builder, AgentRuntime, AgentRuntimeOptions, Logger};

use crate::browser::page_text::host::ConfinedPageReader;
use file_access::{fs, fs_async};

pub(crate) struct Running {
    pub(crate) runtime: AgentRuntime,
}

static RUNNING: Mutex<Option<Arc<Running>>> = Mutex::new(None);
static STARTING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static PUSHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static STOPPED: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

const CALL_LIMIT: Duration = Duration::from_secs(600);
const CONNECT_LIMIT: Duration = Duration::from_secs(10);
const NOT_ANSWERED: &str = "Misty's agent runtime didn't answer.";

fn current() -> Option<Arc<Running>> {
    RUNNING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

fn client() -> Result<reqwest::Client, String> {
    runtime_client_builder()
        .no_proxy()
        .connect_timeout(CONNECT_LIMIT)
        .build()
        .map_err(|_| "Misty couldn't start its agent runtime.".to_owned())
}

pub(crate) fn data_dir() -> Option<std::path::PathBuf> {
    file_access::paths::misty_home_dir().map(|home| home.join("runtime"))
}

async fn push_models(app: &tauri::AppHandle, runtime: &AgentRuntime) -> Result<(), String> {
    let _pushing = PUSHING.lock().await;
    let document = crate::agents::models::device_document(app)
        .await?
        .unwrap_or_else(|| serde_json::json!({}));
    runtime
        .set_device_models(&document)
        .map_err(|_| "Misty couldn't give its agent runtime this device's models.".to_owned())
}

async fn start(app: &tauri::AppHandle) -> Result<Running, String> {
    let home = data_dir().ok_or("Misty's data folder is unavailable.")?;
    fs_async::create_dir_all(&home)
        .await
        .map_err(|_| "Misty couldn't create the agent runtime's folder.")?;
    let client = client()?;
    let runtime = AgentRuntime::new(AgentRuntimeOptions {
        data_dir: home.clone(),
        client: client.clone(),
        logger: Logger::to(log::sink(home.join("runtime.log"))),
        page_reader: Arc::new(ConfinedPageReader),
        local_tools: Some(Arc::new(local_tools::AppToolHost { app: app.clone() })),
        run_host: Arc::new(local_runs::AppRunHost { app: app.clone() }),
        before_tool: None,
    })
    .map_err(|_| "Misty couldn't open the agent runtime's runs.")?;
    push_models(app, &runtime).await?;
    if let Err(error) = runtime.resume_unfinished().await {
        eprintln!(
            "Could not resume the agent runtime's runs: {}",
            error.kind()
        );
    }
    Ok(Running { runtime })
}

pub(crate) async fn ensure(app: &tauri::AppHandle) -> Result<Arc<Running>, String> {
    if let Some(running) = current() {
        return Ok(running);
    }
    let _starting = STARTING.lock().await;
    if let Some(running) = current() {
        return Ok(running);
    }
    if STOPPED.load(Ordering::SeqCst) {
        return Err("Misty is closing.".to_owned());
    }
    let _ = APP.set(app.clone());
    let running = Arc::new(start(app).await?);
    *RUNNING.lock().unwrap_or_else(PoisonError::into_inner) = Some(running.clone());
    Ok(running)
}

pub fn resume_at_launch(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let unfinished = data_dir()
            .and_then(|home| fs::read_dir(home.join("runs")).ok())
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "json")
            });
        if unfinished {
            if let Err(error) = ensure(&app).await {
                eprintln!("Could not resume the agent runtime's runs: {error}");
            }
        }
    });
}

pub(crate) async fn contained<T: Send + 'static>(
    work: impl Future<Output = T> + Send + 'static,
) -> Result<T, String> {
    contained_within(CALL_LIMIT, work).await
}

async fn contained_within<T: Send + 'static>(
    limit: Duration,
    work: impl Future<Output = T> + Send + 'static,
) -> Result<T, String> {
    let mut task = tokio::spawn(work);
    match tokio::time::timeout(limit, &mut task).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err(NOT_ANSWERED.to_owned()),
        Err(_) => {
            task.abort();
            Err(NOT_ANSWERED.to_owned())
        }
    }
}

pub fn models_changed() {
    let Some(app) = APP.get().cloned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        drop(STARTING.lock().await);
        let Some(running) = current() else {
            return;
        };
        if let Err(error) = push_models(&app, &running.runtime).await {
            eprintln!("Could not give the agent runtime this device's models: {error}");
        }
    });
}

pub fn stop() {
    STOPPED.store(true, Ordering::SeqCst);
    let running = RUNNING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    if let Some(running) = running {
        running.runtime.shutdown();
    }
    crate::browser::page_text::host::clean_up();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_panic_in_a_call_fails_that_call_and_nothing_else() {
        let failed = contained(async {
            if true {
                panic!("a run went wrong with sk-secret");
            }
        })
        .await;
        assert_eq!(failed.unwrap_err(), NOT_ANSWERED);
        assert_eq!(contained(async { 7 }).await.unwrap(), 7);
    }

    #[tokio::test]
    async fn a_call_that_never_ends_is_given_up_on() {
        let failed =
            contained_within(Duration::from_millis(10), std::future::pending::<()>()).await;
        assert_eq!(failed.unwrap_err(), NOT_ANSWERED);
    }

    #[test]
    fn no_build_profile_makes_panics_abort() {
        let manifest = include_str!("../../../Cargo.toml");
        assert!(manifest.contains("[profile.release]"));
        for line in manifest.lines().map(str::trim) {
            assert!(
                !(line.starts_with("panic") && line.contains('=')),
                "Cargo.toml sets {line}, and a failed run has to stay inside its task"
            );
        }
        assert!(cfg!(panic = "unwind"));
    }

    #[test]
    fn the_client_builds_without_a_proxy() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        assert!(client().is_ok());
    }
}
