use crate::browser::input::native_input;
use crate::browser::{
    browser_target_observation, resolve_agent_webview, BrowserAgentExecuteRequest,
    BrowserSessionState,
};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager, Webview};

mod batch;
mod consent;
pub(crate) use consent::answer_consent_after_load;
use consent::decline_consent;
mod execute;
mod judge;
pub(crate) use judge::{judge_point, page_controls, scope_site};
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod frames;
pub(in crate::browser) use execute::execute;
mod navigation;
pub(in crate::browser) use navigation::{first_load, navigate, picture};
mod host;
mod site_blocks;
use host::TabHost;
pub(crate) use host::CURSOR_GLIDE_MS;
#[cfg(windows)]
pub mod windows;
pub(in crate::browser) use batch::upload;
pub(in crate::browser) use site_blocks::blocked as site_blocked;
pub(crate) use site_blocks::SiteBlocks;

const RUNTIME: &str = misty_page_runtime::RUNTIME;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
const WORLD: &str = "misty-agent-page";
const SNAPSHOT_CHARS: u64 = 24_000;

pub(in crate::browser) fn handles(operation: &str) -> bool {
    matches!(
        operation,
        "browser.snapshot"
            | "browser.find"
            | "browser.extract"
            | "browser.wait_for"
            | "browser.console"
            | "browser.network"
            | "browser.storage"
            | "browser.verify"
            | "browser.highlight"
            | "browser.emulate"
            | "browser.pdf"
            | "browser.page_tools"
            | "browser.steps"
            | "browser.fill_form"
            | "browser.skill"
    )
}

pub(in crate::browser) fn acts(operation: &str) -> bool {
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

fn frame_of(view: &Webview, reference: Option<&str>) -> Option<(u64, String)> {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        reference.and_then(|reference| frames::frame_of(view.label(), reference))
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (view, reference);
        None
    }
}

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
            include_str!("../../kiri_link/scripts/semantic_snapshot.js")
        )
    } else {
        String::new()
    };
    let invocation = format!(
        "const args = {}; {semantic}",
        serde_json::to_string(&args).map_err(|error| error.to_string())?
    );
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let evaluate = |body: String| async move {
            match frame {
                Some(frame) => {
                    crate::browser::pages::content_world::evaluate_in_frame(
                        webview.clone(),
                        WORLD,
                        body,
                        frame,
                    )
                    .await
                }
                None => {
                    crate::browser::pages::content_world::evaluate_in_content_world(
                        webview.clone(),
                        WORLD,
                        body,
                    )
                    .await
                }
            }
        };
        let mut raw = evaluate(misty_page_runtime::light_body(operation, &invocation)).await?;
        if misty_page_runtime::missing(&raw) {
            raw = evaluate(misty_page_runtime::full_body(operation, &invocation)).await?;
        }
        serde_json::from_str(&raw)
            .map_err(|error| format!("The page returned invalid data: {error}"))
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = frame;
        if operation == "settle" {
            tokio::time::sleep(Duration::from_millis(300)).await;
            return Ok(json!({"ok": true}));
        }
        let operation = serde_json::to_string(operation).map_err(|error| error.to_string())?;
        crate::browser::eval_json(
            webview.clone(),
            format!(
                "(() => {{ {RUNTIME}\n{invocation}\nconst page = globalThis.__mistyAgentPageV1;\nreturn page.call({operation}, args); }})()"
            ),
        )
        .await
    }
}

async fn with_frame_trees(view: &Webview, snapshot: &mut Value) {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let reads = frames::trees(view).await;
        if let (false, Some(tree)) = (reads.is_empty(), snapshot["tree"].as_str()) {
            snapshot["tree"] = json!(frames::splice_trees(tree, &reads));
            snapshot["skills"] = frames::merge_skills(&snapshot["skills"], &reads);
        }
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    let _ = (view, snapshot);
}

fn page_error(result: &Value, fallback: &str) -> String {
    let message = result["error"].as_str().unwrap_or(fallback);
    match result["errorCode"].as_str() {
        Some("browser_snapshot_stale") => format!("browser_snapshot_stale: {message}"),
        _ => message.to_owned(),
    }
}

fn rejected(code: &str, message: impl Into<String>) -> Value {
    json!({"status": "failure", "attempted": false, "tool_error": {"code": code, "message": message.into()}})
}

fn webview(app: &AppHandle, id: &str) -> Result<Webview, String> {
    app.get_webview(&crate::browser::webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())
}
