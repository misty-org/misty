use super::owned;
use misty_page_runtime::{Approval, PageHost};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager, Webview};

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
const RUNTIME: &str = misty_page_runtime::RUNTIME;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
const WORLD: &str = "misty-app-agent";

const OPERATIONS: &[&str] = &[
    "highlight",
    "highlightClear",
    "snapshot",
    "compact",
    "observe",
    "prepare",
    "console",
    "consoleClear",
    "network",
    "networkClear",
    "networkRequest",
    "verify",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageAgentRequest {
    pub mount: String,
    pub operation: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageStepsRequest {
    pub mount: String,
    pub input: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageInputRequest {
    pub mount: String,
    pub action: Value,
    pub viewport: Value,
    #[serde(default)]
    pub editable: bool,
}

#[tauri::command]
pub async fn space_app_page_agent(
    caller: Webview,
    request: AppPageAgentRequest,
) -> Result<Value, String> {
    if !OPERATIONS.contains(&request.operation.as_str()) {
        return Err("That isn't something Misty reads or does in an app.".into());
    }
    let page = owned(&caller, &request.mount)?.ok_or("The app has closed.")?;
    call(&page, &request.operation, &request.args).await
}

async fn call(page: &Webview, operation: &str, args: &Value) -> Result<Value, String> {
    let args = if args.is_object() {
        args.clone()
    } else {
        json!({})
    };
    let invocation = format!(
        "const args = {};",
        serde_json::to_string(&args).map_err(|error| error.to_string())?
    );
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let evaluate = |body: String| {
            crate::browser::pages::content_world::evaluate_in_content_world(
                page.clone(),
                WORLD,
                body,
            )
        };
        let mut raw = evaluate(misty_page_runtime::light_body(operation, &invocation)).await?;
        if misty_page_runtime::missing(&raw) {
            raw = evaluate(misty_page_runtime::full_body(operation, &invocation)).await?;
        }
        serde_json::from_str(&raw)
            .map_err(|error| format!("The app returned invalid data: {error}"))
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let operation = serde_json::to_string(operation).map_err(|error| error.to_string())?;
        crate::browser::eval_json(
            page.clone(),
            format!("(() => {{ {RUNTIME}\n{invocation}\nconst page = globalThis.__mistyAgentPageV1;\nreturn page.call({operation}, args); }})()"),
        )
        .await
    }
}

#[tauri::command]
pub async fn space_app_page_input(
    caller: Webview,
    request: AppPageInputRequest,
) -> Result<Value, String> {
    crate::browser::input::native_input::validate(&request.action)?;
    let page = owned(&caller, &request.mount)?.ok_or("The app has closed.")?;
    native(&page, &request.action, &request.viewport, request.editable).await
}

#[cfg(target_os = "macos")]
async fn native(
    page: &Webview,
    action: &Value,
    viewport: &Value,
    editable: bool,
) -> Result<Value, String> {
    let encoded = json!({"action": action, "viewport": viewport, "editable": editable});
    let (send, receive) = tokio::sync::oneshot::channel();
    page.with_webview(move |platform| {
        let result = (|| {
            let mtm = objc2::MainThreadMarker::new()
                .ok_or_else(|| String::from("Misty couldn't act in the app."))?;
            // SAFETY: `inner` is the app page's live WKWebView, and this runs on the main thread.
            let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
            let result = crate::browser::input::macos::perform(mtm, view, &encoded);
            match result["error"].as_str() {
                Some(error) => Err(error.to_owned()),
                None => Ok(result),
            }
        })();
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[cfg(windows)]
async fn native(
    page: &Webview,
    action: &Value,
    viewport: &Value,
    editable: bool,
) -> Result<Value, String> {
    use crate::browser::input::native_input::windows;
    let allow: windows::Authorize = std::sync::Arc::new(|| Ok(()));
    windows::act(page, allow, action, size_from(viewport)?, editable).await
}

#[cfg(target_os = "linux")]
async fn native(
    page: &Webview,
    action: &Value,
    viewport: &Value,
    editable: bool,
) -> Result<Value, String> {
    use crate::browser::input::native_input::linux;
    let _ = editable;
    let allow: linux::Authorize = std::sync::Arc::new(|| Ok(()));
    linux::act(page, allow, action, size_from(viewport)?).await
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
async fn native(_: &Webview, _: &Value, _: &Value, _: bool) -> Result<Value, String> {
    Err("Native input isn't available here.".into())
}

#[cfg(any(windows, target_os = "linux"))]
fn size_from(viewport: &Value) -> Result<(f64, f64), String> {
    match (viewport["width"].as_f64(), viewport["height"].as_f64()) {
        (Some(width), Some(height)) if width > 0.0 && height > 0.0 => Ok((width, height)),
        _ => Err("The app's view has no size.".into()),
    }
}

const POINT_EVENT: &str = "misty://app-page-point";
const TARGET_PX: f64 = 24.0;
const ARRIVE_MS: u64 = 60;

static POINTERS: OnceLock<Mutex<HashMap<String, (f64, f64)>>> = OnceLock::new();

fn travel_ms(distance: f64) -> u64 {
    if distance.is_nan() || distance < 1.0 {
        return 0;
    }
    (140.0 + 120.0 * (distance / TARGET_PX + 1.0).log2()).clamp(160.0, 720.0) as u64
}

struct AppHost {
    page: Webview,
    owner: String,
    mount: String,
}

impl PageHost for AppHost {
    async fn call(
        &self,
        frame: Option<u64>,
        operation: &str,
        args: Value,
        semantic: bool,
    ) -> Result<Value, String> {
        let _ = semantic;
        if frame.is_some() {
            return Err("Misty reads an app's own page, not the frames inside it.".into());
        }
        call(&self.page, operation, &args).await
    }

    async fn native(&self, input: Value, prepared: &Value) -> Result<Option<Value>, String> {
        if misty_page_runtime::validate_native_input(&input).is_err() {
            return Ok(None);
        }
        Ok(native(
            &self.page,
            &input,
            &prepared["viewport"],
            prepared["editable"] == true,
        )
        .await
        .ok())
    }

    async fn approve(&self, kind: &str, control: &str, reason: &str) -> Approval {
        let _ = (kind, control, reason);
        Approval::Unasked
    }

    fn authorize(&self) -> Result<(), String> {
        if self
            .page
            .app_handle()
            .get_webview(self.page.label())
            .is_none()
        {
            return Err("The app has closed.".into());
        }
        Ok(())
    }

    async fn sleep(&self, ms: u64) {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    fn fresh_id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }

    async fn capture(
        &self,
        region: [f64; 4],
        image_width: f64,
        lossless: bool,
    ) -> Result<Value, String> {
        crate::browser::pages::native_page::capture(&self.page, region, image_width, lossless).await
    }

    async fn emulate(&self, request: Value) -> Result<Value, String> {
        crate::browser::pages::native_page::emulate(&self.page, request).await
    }

    async fn resize(&self, size: Option<(f64, f64)>) -> Result<(), String> {
        crate::browser::pages::emulated_size::set(self.page.app_handle(), &self.page, size)
    }

    async fn pdf(&self) -> Result<Vec<u8>, String> {
        crate::browser::pages::native_page::pdf(&self.page).await
    }

    fn url(&self) -> Option<String> {
        self.page.url().ok().map(|url| url.to_string())
    }

    fn go(&self, to: misty_page_runtime::Go<'_>) -> Result<(), String> {
        let script = match to {
            misty_page_runtime::Go::Address(_) => {
                return Err("An app stays on its own pages.".into());
            }
            misty_page_runtime::Go::Back => "history.back()",
            misty_page_runtime::Go::Forward => "history.forward()",
            misty_page_runtime::Go::Reload => "location.reload()",
        };
        self.page.eval(script).map_err(|error| error.to_string())
    }

    async fn point(&self, prepared: &Value) {
        let (Some(x), Some(y)) = (
            prepared["point"]["x"].as_f64(),
            prepared["point"]["y"].as_f64(),
        ) else {
            return;
        };
        let _ = self.page.app_handle().emit_to(
            self.owner.clone(),
            POINT_EVENT,
            json!({"mount": self.mount, "x": x, "y": y}),
        );
        let width = prepared["viewport"]["width"].as_f64().unwrap_or(0.0);
        let height = prepared["viewport"]["height"].as_f64().unwrap_or(0.0);
        let before = POINTERS
            .get_or_init(Mutex::default)
            .lock()
            .ok()
            .and_then(|mut pointers| pointers.insert(self.mount.clone(), (x, y)));
        let Some((from_x, from_y)) = before else {
            return;
        };
        let travel = travel_ms(((x - from_x) * width).hypot((y - from_y) * height));
        if travel > 0 {
            tokio::time::sleep(Duration::from_millis(travel + ARRIVE_MS)).await;
        }
    }
}

#[tauri::command]
pub async fn space_app_page_steps(
    caller: Webview,
    request: AppPageStepsRequest,
) -> Result<Value, String> {
    let page = owned(&caller, &request.mount)?.ok_or("The app has closed.")?;
    let parsed = if request.input.get("fields").is_some() {
        misty_page_runtime::form_steps(&request.input)
    } else {
        misty_page_runtime::parse_steps(&request.input)
    };
    let steps = match parsed {
        Ok(steps) => steps,
        Err(error) => return Ok(misty_page_runtime::rejected("browser_step_invalid", error)),
    };
    let host = AppHost {
        page,
        owner: caller.label().to_owned(),
        mount: request.mount,
    };
    misty_page_runtime::run_steps(&host, &request.input, &steps).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageHistoryRequest {
    pub mount: String,
    pub history: String,
}

#[tauri::command]
pub async fn space_app_page_navigate(
    caller: Webview,
    request: AppPageHistoryRequest,
) -> Result<Value, String> {
    let page = owned(&caller, &request.mount)?.ok_or("The app has closed.")?;
    let go = misty_page_runtime::Go::history(&request.history)
        .ok_or("history is back, forward or reload.")?;
    let host = AppHost {
        page,
        owner: caller.label().to_owned(),
        mount: request.mount,
    };
    misty_page_runtime::navigate(&host, go, true).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPagePictureRequest {
    pub mount: String,
    #[serde(default)]
    pub input: Value,
}

#[tauri::command]
pub async fn space_app_page_picture(
    caller: Webview,
    request: AppPagePictureRequest,
) -> Result<Value, String> {
    let page = owned(&caller, &request.mount)?.ok_or("The app has closed.")?;
    let host = AppHost {
        page,
        owner: caller.label().to_owned(),
        mount: request.mount,
    };
    misty_page_runtime::picture(&host, &request.input).await
}

#[tauri::command]
pub async fn space_app_page_emulate(
    caller: Webview,
    request: AppPagePictureRequest,
) -> Result<Value, String> {
    let page = owned(&caller, &request.mount)?.ok_or("The app has closed.")?;
    let host = AppHost {
        page,
        owner: caller.label().to_owned(),
        mount: request.mount,
    };
    misty_page_runtime::emulate(&host, &request.input).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPagePdfRequest {
    pub mount: String,
    pub run_id: String,
    #[serde(default)]
    pub path: String,
}

#[tauri::command]
pub async fn space_app_page_pdf(caller: Webview, request: AppPagePdfRequest) -> Result<Value, String> {
    crate::project::person_window(&caller)?;
    let page = owned(&caller, &request.mount)?.ok_or("The app has closed.")?;
    let host = AppHost {
        page,
        owner: caller.label().to_owned(),
        mount: request.mount,
    };
    let bytes = PageHost::pdf(&host).await?;
    let asked = if request.path.trim().is_empty() {
        "page.pdf".to_owned()
    } else if request.path.to_ascii_lowercase().ends_with(".pdf") {
        request.path
    } else {
        format!("{}.pdf", request.path)
    };
    let size = bytes.len();
    let run = request.run_id;
    let saved = tauri::async_runtime::spawn_blocking(move || {
        crate::apps::agent_files::save(&run, &asked, &bytes)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(json!({"saved": saved, "bytes": size}))
}
