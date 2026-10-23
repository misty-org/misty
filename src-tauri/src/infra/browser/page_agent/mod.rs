//! Text-first page layer for agents (docs/agents/harness.md, Page layer):
//! accessibility snapshots with refs that survive actions, batches of actions
//! by ref, waiting without model calls, and page text for extraction.
//!
//! On macOS the runtime lives in its own WKContentWorld, so page scripts can
//! neither read nor forge its refs, and clicks and keys arrive as native,
//! trusted input. Other platforms use the page world and script events.
use super::{
    browser_target_observation, native_input, resolve_agent_webview, BrowserAgentExecuteRequest,
    BrowserSessionState,
};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Webview};

mod batch;
mod consent;
pub(crate) use consent::answer_consent_after_load;
use consent::decline_consent;
#[cfg(any(target_os = "macos", windows))]
mod frames;
#[cfg(all(test, windows))]
mod frames_probe_windows;
mod execute;
pub(super) use execute::execute;
use execute::poll;
mod navigation;
pub(super) use navigation::{first_load, landed, mark_document};
mod site_blocks;
mod step;
pub(crate) use step::CURSOR_GLIDE_MS;
mod steps;
pub(super) use batch::upload;
use batch::{run_skill, run_steps};
pub(super) use site_blocks::{blocked as site_blocked, SiteBlocks};
use steps::Step;

const RUNTIME: &str = concat!(
    include_str!("page_core.js"),
    "\n",
    include_str!("page_tree.js"),
    "\n",
    include_str!("page_actions.js"),
    "\n",
    include_str!("page_read.js"),
    "\n",
    include_str!("page_skills.js")
);
#[cfg(any(target_os = "macos", windows))]
const WORLD: &str = "misty-agent-page";
const SNAPSHOT_CHARS: u64 = 24_000;
const AFTER_STEPS_SNAPSHOT_CHARS: u64 = 12_000;

/// Operations this layer answers. Reads observe; `steps` and `fill_form` act.
pub(super) fn handles(operation: &str) -> bool {
    matches!(
        operation,
        "browser.snapshot"
            | "browser.find"
            | "browser.extract"
            | "browser.wait_for"
            | "browser.steps"
            | "browser.fill_form"
            | "browser.skill"
    )
}

pub(super) fn acts(operation: &str) -> bool {
    matches!(
        operation,
        "browser.steps" | "browser.fill_form" | "browser.skill"
    )
}

async fn call(
    webview: &Webview,
    operation: &str,
    args: Value,
    semantic: bool,
) -> Result<Value, String> {
    call_at(webview, None, operation, args, semantic).await
}

/// The cross-origin frame a ref belongs to and its document id (frames.rs); None for the
/// top document's refs.
fn frame_of(view: &Webview, reference: Option<&str>) -> Option<(u64, String)> {
    #[cfg(any(target_os = "macos", windows))]
    {
        reference.and_then(|reference| frames::frame_of(view.label(), reference))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (view, reference);
        None
    }
}

/// `call` in the top document, or in one cross-origin frame of it.
async fn call_at(
    webview: &Webview,
    frame: Option<u64>,
    operation: &str,
    args: Value,
    semantic: bool,
) -> Result<Value, String> {
    let semantic = if semantic {
        format!(
            "args.readSemantic = ({});",
            include_str!("../scripts/semantic_snapshot.js")
        )
    } else {
        String::new()
    };
    let invocation = format!(
        "const args = {}; {semantic} const page = globalThis.__mistyAgentPageV1;",
        serde_json::to_string(&args).map_err(|error| error.to_string())?
    );
    let operation = serde_json::to_string(operation).map_err(|error| error.to_string())?;
    #[cfg(any(target_os = "macos", windows))]
    {
        let body = format!(
            "{RUNTIME}\n{invocation}\nreturn JSON.stringify(await page.call({operation}, args));"
        );
        let raw = match frame {
            Some(frame) => {
                crate::infra::browser_content_world::evaluate_in_frame(
                    webview.clone(),
                    WORLD,
                    body,
                    frame,
                )
                .await?
            }
            None => {
                crate::infra::browser_content_world::evaluate_in_content_world(
                    webview.clone(),
                    WORLD,
                    body,
                )
                .await?
            }
        };
        serde_json::from_str(&raw)
            .map_err(|error| format!("The page returned invalid data: {error}"))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = frame;
        // The page world has no awaiting evaluation; settle is a host sleep there.
        if operation == "\"settle\"" {
            tokio::time::sleep(Duration::from_millis(300)).await;
            return Ok(json!({"ok": true}));
        }
        super::eval_json(
            webview.clone(),
            format!(
                "(() => {{ {RUNTIME}\n{invocation}\nreturn page.call({operation}, args); }})()"
            ),
        )
        .await
    }
}

/// Adds what the page's cross-origin frames show under their iframes (frames.rs).
async fn with_frame_trees(view: &Webview, snapshot: &mut Value) {
    #[cfg(any(target_os = "macos", windows))]
    {
        let reads = frames::trees(view).await;
        if let (false, Some(tree)) = (reads.is_empty(), snapshot["tree"].as_str()) {
            snapshot["tree"] = json!(frames::splice_trees(tree, &reads));
            snapshot["skills"] = frames::merge_skills(&snapshot["skills"], &reads);
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = (view, snapshot);
}

fn page_error(result: &Value, fallback: &str) -> String {
    let message = result["error"].as_str().unwrap_or(fallback);
    match result["errorCode"].as_str() {
        Some("browser_snapshot_stale") => format!("browser_snapshot_stale: {message}"),
        _ => message.to_owned(),
    }
}

/// A call rejected before it touched the page, with a reason the model can act
/// on. It completes the device job, so the message survives intact.
fn rejected(code: &str, message: impl Into<String>) -> Value {
    json!({"status": "failure", "attempted": false, "tool_error": {"code": code, "message": message.into()}})
}

fn webview(app: &AppHandle, id: &str) -> Result<Webview, String> {
    app.get_webview(&super::webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())
}
