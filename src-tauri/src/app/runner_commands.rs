//! Coding tools on this device: which are installed and signed in, routing a
//! delegated task to one, running its turns and stopping it. The app drives a
//! run: it takes the lease from the server, starts each turn here, mirrors the
//! events and answers permission questions through the server's cards.
#![cfg(desktop)]

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::agents::runners::{
    bridge::BridgeContext,
    detect,
    events::RateLimit,
    http_host::{driver::run_hosted_turn, hosted_for},
    lease::{Lease, LeaseMeter},
    registry, route, runner_for,
    session::{run_turn, Outcome},
    supported,
    tauri_host::{self, TauriHost},
    EngineId, Launch, LaunchMode, RunnerError,
};
use crate::app::device_commands::require_device_window;
use crate::app::runtime::MistyRuntime;

/// Every coding tool's install and sign-in status on this device.
#[tauri::command]
pub async fn coding_engines_detect(
    webview: tauri::Webview,
) -> Result<Vec<detect::EngineStatus>, String> {
    require_device_window(&webview)?;
    tokio::task::spawn_blocking(detect::detect_all)
        .await
        .map_err(|_| "Misty couldn't check your coding tools.".to_owned())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteRequest {
    pub default: Option<String>,
    pub fallback: Option<String>,
    pub cap_percent: Option<f64>,
    /// "plan" or "edit".
    pub mode: String,
    pub permission: String,
    /// Engines the server already refused for this run, with recent usage.
    #[serde(default)]
    pub exclude: Vec<String>,
    #[serde(default)]
    pub limits: Vec<(String, RateLimit)>,
}

fn launch_mode(mode: &str, permission: &str) -> LaunchMode {
    match (mode, permission) {
        ("plan", _) => LaunchMode::Plan,
        (_, "auto") => LaunchMode::AutoEdit,
        _ => LaunchMode::Ask,
    }
}

/// The tool for a delegated task, or the plain reason none qualifies.
#[tauri::command]
pub async fn coding_route(
    webview: tauri::Webview,
    request: RouteRequest,
) -> Result<String, String> {
    require_device_window(&webview)?;
    let pick = |id: &Option<String>| {
        id.as_deref()
            .and_then(EngineId::parse)
            .filter(|e| !request.exclude.iter().any(|x| x == e.as_str()))
    };
    let prefs = route::RoutePrefs {
        default: pick(&request.default),
        fallback: pick(&request.fallback),
        cap_percent: request.cap_percent,
    };
    let need = route::RouteNeed {
        mode: launch_mode(&request.mode, &request.permission),
        permission: request.permission.clone(),
        grants: vec![],
    };
    let limits: Vec<(EngineId, RateLimit)> = request
        .limits
        .iter()
        .filter_map(|(id, limit)| EngineId::parse(id).map(|e| (e, limit.clone())))
        .collect();
    let statuses = tokio::task::spawn_blocking(detect::detect_all)
        .await
        .map_err(|_| "Misty couldn't check your coding tools.".to_owned())?;
    route::route(&prefs, &statuses, &limits, &need).map(|engine| engine.as_str().to_owned())
}

/// The project's GitHub remote as owner/name, for remembered pushes.
#[tauri::command]
pub async fn coding_project_remote(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> Result<Option<String>, String> {
    require_device_window(&webview)?;
    let project = state
        .agents
        .project(scope_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(tauri_host::github_remote(&project.root))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRequest {
    pub run_id: String,
    pub scope_id: String,
    pub engine: String,
    pub task: String,
    pub mode: String,
    pub permission: String,
    pub model: Option<String>,
    pub session: Option<String>,
    pub lease: Lease,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResult {
    /// finished, canceled, budget_exhausted or failed.
    pub outcome: &'static str,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
}

/// Runs one turn of a delegated coding task in its project.
#[tauri::command]
pub async fn coding_run_turn(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    request: TurnRequest,
) -> Result<TurnResult, String> {
    require_device_window(&webview)?;
    let engine = EngineId::parse(&request.engine).ok_or("Unknown coding tool.")?;
    if !supported(engine) {
        return Err("This coding tool isn't supported yet.".into());
    }
    let project = state
        .agents
        .project(request.scope_id.clone())
        .await
        .map_err(|error| error.to_string())?;
    let mode = launch_mode(&request.mode, &request.permission);
    let launch = Launch {
        project_root: project.root.clone(),
        task: request.task,
        mode,
        model: request.model,
        session: request.session,
        grants: request.lease.grants.clone(),
    };
    let context = BridgeContext {
        mode: request.permission,
        plan: mode == LaunchMode::Plan,
        project_root: PathBuf::from(&project.root),
        grants: request.lease.grants.clone(),
        lease_valid: true,
    };
    // Undo needs the project as it was before the run's first change.
    if mode != LaunchMode::Plan {
        let (store, scope, run, root) = (
            crate::app::checkpoint_commands::checkpoints(&state),
            request.scope_id.clone(),
            request.run_id.clone(),
            project.root.clone(),
        );
        // Without a copy the run still goes ahead; it just can't be undone.
        let _ = tokio::task::spawn_blocking(move || store.ensure(&scope, &run, &root)).await;
    }
    let stop = registry::register(
        &request.run_id,
        engine.as_str(),
        &project.root.to_string_lossy(),
    )
    .ok_or("This coding task is already running.")?;
    let host = TauriHost {
        app,
        run_id: request.run_id.clone(),
    };
    let mut meter = LeaseMeter::new(request.lease);
    let outcome = match (runner_for(engine), hosted_for(engine)) {
        (Some(runner), _) => {
            run_turn(runner.as_ref(), &launch, context, &mut meter, &host, stop).await
        }
        (None, Some(hosted)) => {
            run_hosted_turn(hosted.as_ref(), &launch, context, &mut meter, &host, stop).await
        }
        (None, None) => Err(RunnerError::Unsupported("this coding tool isn't supported")),
    };
    registry::finish(&request.run_id);
    Ok(match outcome {
        Ok(Outcome::Finished) => TurnResult {
            outcome: "finished",
            message: String::new(),
        },
        Ok(Outcome::Canceled) => TurnResult {
            outcome: "canceled",
            message: String::new(),
        },
        Ok(Outcome::BudgetExhausted) => TurnResult {
            outcome: "budget_exhausted",
            message: String::new(),
        },
        Ok(Outcome::Failed(message)) => TurnResult {
            outcome: "failed",
            message,
        },
        Err(_) => TurnResult {
            outcome: "failed",
            message: format!(
                "{} couldn't start in this project.",
                route::display_name(engine)
            ),
        },
    })
}

/// The person's answer to a coding tool's permission question.
#[tauri::command]
pub fn coding_runner_answer(
    webview: tauri::Webview,
    id: String,
    allow: bool,
) -> Result<bool, String> {
    require_device_window(&webview)?;
    Ok(tauri_host::answer(&id, allow))
}

/// Stops a delegated coding run's tool. Returns whether it was running.
#[tauri::command]
pub fn coding_runner_stop(webview: tauri::Webview, run_id: String) -> Result<bool, String> {
    require_device_window(&webview)?;
    Ok(registry::stop(&run_id))
}
