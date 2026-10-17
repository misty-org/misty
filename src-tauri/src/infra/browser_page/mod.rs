//! Text-first page layer for agents (docs/plans/agentic-browser.md, Phase 1):
//! accessibility snapshots with refs that survive actions, batches of actions
//! by ref, waiting without model calls, and page text for extraction.
//!
//! On macOS the runtime lives in its own WKContentWorld, so page scripts can
//! neither read nor forge its refs, and clicks and keys arrive as native,
//! trusted input. Other platforms use the page world and script events.
use super::{
    browser_target_observation, native_input, resolve_agent_webview, webview_label,
    BrowserAgentExecuteRequest, BrowserSessionState,
};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Webview};

mod batch;
#[cfg(any(target_os = "macos", windows))]
mod frames;
mod site_blocks;
mod step;
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
            include_str!("../browser_semantic_snapshot.js")
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

/// The page a navigation lands on, once its document has loaded and gone quiet, as the
/// model reads it: the agent sees the new page in the same step instead of guessing its
/// next look (docs/plans/odysseys-campaign.md). None when the page never answered.
pub(super) async fn landed(
    app: &AppHandle,
    id: &str,
    previous: &url::Url,
    target: &url::Url,
) -> Option<Value> {
    let started = tokio::time::Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let view = webview(app, id).ok()?;
        let moved = view.url().ok().as_ref() != Some(previous)
            || (previous == target && started.elapsed() > Duration::from_millis(1200));
        let ready = call(&view, "waitCheck", json!({}), false)
            .await
            .is_ok_and(|check| check["ready"] == true);
        if (moved && ready) || started.elapsed() > Duration::from_secs(15) {
            break;
        }
    }
    let view = webview(app, id).ok()?;
    let _ = call(
        &view,
        "settle",
        json!({"quietMs": 400, "maxMs": 3000}),
        false,
    )
    .await;
    let args = json!({"candidateId": uuid::Uuid::new_v4().to_string(), "maxChars": SNAPSHOT_CHARS, "maxRefs": 800});
    let mut snapshot = call(&view, "snapshot", args, true).await.ok()?;
    with_frame_trees(&view, &mut snapshot).await;
    (snapshot["ok"] == true).then(|| {
        json!({"documentId": snapshot["documentId"], "url": snapshot["url"], "title": snapshot["title"],
            "tree": snapshot["tree"], "truncated": snapshot["truncated"], "skills": snapshot["skills"]})
    })
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
    app.get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())
}

pub(super) async fn execute(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let view = webview(app, id)?;
    let observed_url = view.url().map_err(|error| error.to_string())?;
    let target = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        let session = sessions.get(id).ok_or("Browser tab is not running.")?;
        browser_target_observation(session, &observed_url)
    };
    if target["authentication"] == "required" {
        if acts(&request.operation) {
            return Ok(rejected("browser_authentication_required", "This page needs the person to sign in. Call browser_request_user_action, then take a new snapshot."));
        }
        let mut safe_url = observed_url.clone();
        safe_url.set_query(None);
        safe_url.set_fragment(None);
        return Ok(json!({
            "documentId": uuid::Uuid::new_v4().to_string(), "url": safe_url.to_string(), "title": "Sign-in required",
            "tree": "- text: Complete sign-in in the original browser. Call browser_request_user_action before continuing.",
            "truncated": true, "contentTrust": "untrusted-web-page", "target": target,
        }));
    }
    let input = &request.input;
    let result = match request.operation.as_str() {
        "browser.snapshot" => {
            let max = input["maxChars"]
                .as_u64()
                .unwrap_or(SNAPSHOT_CHARS)
                .clamp(2_000, 60_000);
            let mut args = json!({"candidateId": uuid::Uuid::new_v4().to_string(), "maxChars": max, "maxRefs": 800});
            if let Some(scope) = input["scopeRef"].as_str() {
                args["scopeRef"] = json!(scope);
            }
            let scoped = !input["scopeRef"].is_null();
            let mut result = call(&view, "snapshot", args, true).await?;
            if result["ok"] != true {
                return Err(page_error(&result, "The page could not be read."));
            }
            if !scoped {
                with_frame_trees(&view, &mut result).await;
            }
            result
        }
        "browser.find" => {
            let Some(query) = input["query"]
                .as_str()
                .filter(|query| !query.trim().is_empty() && query.len() <= 500)
            else {
                return Ok(rejected(
                    "browser_step_invalid",
                    "Describe the element to find in up to 500 characters.",
                ));
            };
            let limit = input["limit"].as_u64().unwrap_or(8).clamp(1, 20);
            let args = json!({"candidateId": uuid::Uuid::new_v4().to_string(), "query": query, "limit": limit});
            let result = call(&view, "find", args, true).await?;
            if result["ok"] != true {
                return Err(page_error(&result, "The page could not be searched."));
            }
            result
        }
        "browser.extract" => {
            let mut result = call(&view, "markdown", json!({"maxChars": 120_000}), false).await?;
            if result["ok"] != true {
                return Err(page_error(&result, "The page could not be read."));
            }
            #[cfg(any(target_os = "macos", windows))]
            {
                let reads = frames::markdown(&view).await;
                if let (false, Some(markdown)) = (reads.is_empty(), result["markdown"].as_str()) {
                    result["markdown"] = json!(frames::append_markdown(markdown, &reads));
                }
            }
            result
        }
        "browser.wait_for" => match wait_for(&view, input).await {
            Err(error) if error.starts_with("Wait for") => {
                return Ok(rejected("browser_step_invalid", error))
            }
            result => result?,
        },
        "browser.skill" => run_skill(app, state, &view, request).await?,
        "browser.steps" | "browser.fill_form" => {
            let parsed = if request.operation == "browser.steps" {
                steps::parse_steps(input)
            } else {
                steps::form_steps(input)
            };
            match parsed {
                Ok(steps) => run_steps(app, state, &view, request, &steps).await?,
                Err(error) => return Ok(rejected("browser_step_invalid", error)),
            }
        }
        _ => return Err("Unsupported browser agent operation.".into()),
    };
    // A navigation while reading means the result describes a page that is gone.
    if !acts(&request.operation) && view.url().map_err(|error| error.to_string())? != observed_url {
        return Err(
            "browser_document_changed: the page navigated while it was read; read it again".into(),
        );
    }
    let mut result = result;
    result["contentTrust"] = json!("untrusted-web-page");
    result["target"] = target;
    if let Some(object) = result.as_object_mut() {
        object.remove("ok");
    }
    Ok(result)
}

async fn wait_for(view: &Webview, input: &Value) -> Result<Value, String> {
    let condition = json!({
        "text": input["text"].as_str(), "textGone": input["textGone"].as_str(), "urlIncludes": input["urlIncludes"].as_str(),
    });
    if condition["text"].is_null()
        && condition["textGone"].is_null()
        && condition["urlIncludes"].is_null()
    {
        return Err("Wait for text, textGone or urlIncludes.".into());
    }
    let timeout = input["timeoutMs"]
        .as_u64()
        .unwrap_or(8_000)
        .clamp(100, steps::MAX_WAIT_MS);
    poll(view, &condition, timeout).await
}

async fn poll(view: &Webview, condition: &Value, timeout_ms: u64) -> Result<Value, String> {
    let started = Instant::now();
    loop {
        let check = call(view, "waitCheck", condition.clone(), false).await?;
        // Text can appear inside an embedded widget's frame rather than the page itself.
        #[cfg(any(target_os = "macos", windows))]
        let met = check["met"] == true || (condition["text"].is_string() && frames::shows(view, condition).await);
        #[cfg(not(any(target_os = "macos", windows)))]
        let met = check["met"] == true;
        let waited = started.elapsed().as_millis() as u64;
        if met || waited >= timeout_ms {
            let page = call(view, "observe", json!({}), false).await?;
            return Ok(json!({"met": met, "waitedMs": waited, "page": page}));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}
