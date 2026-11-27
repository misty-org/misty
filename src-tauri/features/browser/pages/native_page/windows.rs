use std::{cell::RefCell, collections::HashMap, sync::Mutex};

use serde_json::{json, Value};
use tauri::Webview;
use tokio::sync::oneshot::Receiver;
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Deferral, ICoreWebView2ScriptDialogOpeningEventArgs,
        COREWEBVIEW2_SCRIPT_DIALOG_KIND, COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT,
        COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD, COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT,
    },
    ScriptDialogOpeningEventHandler,
};
use windows::core::HSTRING;

use super::{clip, cookie_action, cookie_applies, reply, same_site, COOKIE_VALUE_LIMIT};
use crate::browser::pages::windows::{
    capture::{OVERLAY_HIDE, OVERLAY_SHOW},
    webview2::{self, owned_string},
};

type Started<T> = Result<Receiver<Result<T, String>>, String>;

fn spawn<T: Send + 'static>(
    work: impl std::future::Future<Output = Result<T, String>> + Send + 'static,
) -> Started<T> {
    let (done, receiver) = reply::<T>();
    tauri::async_runtime::spawn(async move { done(work.await) });
    Ok(receiver)
}

async fn devtools(view: &Webview, method: &'static str, parameters: Value) -> Result<Value, String> {
    webview2::cdp(view, method, &parameters).await.map_err(String::from)
}

pub(super) fn capture(view: &Webview, region: [f64; 4], image_width: f64, lossless: bool) -> Started<Value> {
    let view = view.clone();
    spawn(async move {
        let [x, y, width, height] = region;
        if ![x, y, width, height, image_width].iter().all(|n| n.is_finite()) || width < 1.0 || height < 1.0 {
            return Err("Capture region is invalid.".into());
        }
        let metrics = devtools(&view, "Page.getLayoutMetrics", json!({})).await?;
        let page_x = metrics["cssVisualViewport"]["pageX"].as_f64().unwrap_or(0.0);
        let page_y = metrics["cssVisualViewport"]["pageY"].as_f64().unwrap_or(0.0);
        let scale = image_width / width;
        let mut parameters = json!({
            "format": if lossless { "png" } else { "jpeg" },
            "fromSurface": true,
            "clip": {"x": page_x + x, "y": page_y + y, "width": width, "height": height, "scale": scale},
        });
        if !lossless {
            parameters["quality"] = json!(80);
        }
        let _ = webview2::evaluate(&view, OVERLAY_HIDE.to_owned(), None).await;
        let shot = devtools(&view, "Page.captureScreenshot", parameters).await;
        let _ = webview2::evaluate(&view, OVERLAY_SHOW.to_owned(), None).await;
        let data = shot?["data"].as_str().ok_or("WebView2 returned no picture.")?.to_owned();
        Ok(json!({
            "dataUrl": format!("data:image/{};base64,{data}", if lossless { "png" } else { "jpeg" }),
            "width": (width * scale).round(),
            "height": (height * scale).round(),
        }))
    })
}

fn described(cookie: &Value) -> Value {
    let mut out = json!({
        "name": cookie["name"],
        "value": clip(cookie["value"].as_str().unwrap_or(""), COOKIE_VALUE_LIMIT),
        "domain": cookie["domain"],
        "path": cookie["path"],
        "httpOnly": cookie["httpOnly"] == true,
        "secure": cookie["secure"] == true,
    });
    if cookie["session"] != true {
        if let Some(expires) = cookie["expires"].as_f64().filter(|expires| *expires > 0.0) {
            out["expires"] = json!(expires.round() as i64);
        }
    }
    if let Some(policy) = cookie["sameSite"].as_str() {
        out["sameSite"] = json!(policy.to_ascii_lowercase());
    }
    out
}

pub(super) fn cookies(view: &Webview, request: Value) -> Started<Value> {
    let view = view.clone();
    spawn(async move {
        let action = cookie_action(&request)?.to_owned();
        if action == "set" {
            let mut cookie = json!({
                "name": request["name"].as_str().filter(|name| !name.is_empty()).ok_or("A cookie needs a name.")?,
                "value": request["value"].as_str().unwrap_or(""),
                "domain": request["domain"].as_str().filter(|domain| !domain.is_empty()).ok_or("A cookie needs a domain.")?,
                "path": request["path"].as_str().unwrap_or("/"),
                "secure": request["secure"] == true,
                "httpOnly": request["httpOnly"] == true,
            });
            if let Some(policy) = same_site(&request)? {
                cookie["sameSite"] = json!(policy);
            }
            if let Some(expires) = request["expires"].as_f64() {
                cookie["expires"] = json!(expires);
            }
            let set = devtools(&view, "Network.setCookie", cookie.clone()).await?;
            if set["success"] == false {
                return Err("WebView2 refused that cookie.".into());
            }
            return Ok(json!({"ok": true, "cookie": described(&cookie)}));
        }
        let all = devtools(&view, "Network.getAllCookies", json!({})).await?;
        let whole = action == "clear";
        let picked: Vec<Value> = all["cookies"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .filter(|cookie| cookie_applies(cookie, &request, whole))
            .cloned()
            .collect();
        if action == "list" || action == "get" {
            return Ok(json!({"ok": true, "cookies": picked.iter().map(described).collect::<Vec<_>>()}));
        }
        for cookie in &picked {
            devtools(
                &view,
                "Network.deleteCookies",
                json!({"name": cookie["name"], "domain": cookie["domain"], "path": cookie["path"]}),
            )
            .await?;
        }
        Ok(json!({"ok": true, "removed": picked.len()}))
    })
}

fn media_state() -> &'static Mutex<HashMap<String, (String, String)>> {
    static STATE: std::sync::OnceLock<Mutex<HashMap<String, (String, String)>>> =
        std::sync::OnceLock::new();
    STATE.get_or_init(Default::default)
}

pub(super) fn emulate(view: &Webview, request: Value) -> Started<Value> {
    let view = view.clone();
    spawn(async move {
        let label = view.label().to_owned();
        let (mut scheme, mut media) = media_state()
            .lock()
            .ok()
            .and_then(|state| state.get(&label).cloned())
            .unwrap_or_default();
        if request["reset"] == true {
            scheme.clear();
            media.clear();
        }
        if let Some(asked) = request["colorScheme"].as_str() {
            scheme = match asked {
                "dark" | "light" => asked.to_owned(),
                "no-preference" => String::new(),
                _ => return Err("colorScheme is light, dark or no-preference.".into()),
            };
        }
        if let Some(asked) = request["media"].as_str() {
            media = match asked {
                "print" => "print".to_owned(),
                "screen" => String::new(),
                _ => return Err("media is screen or print.".into()),
            };
        }
        devtools(
            &view,
            "Emulation.setEmulatedMedia",
            json!({"media": media, "features": [{"name": "prefers-color-scheme", "value": scheme}]}),
        )
        .await?;
        if let Ok(mut state) = media_state().lock() {
            state.insert(label, (scheme.clone(), media.clone()));
        }
        Ok(json!({
            "ok": true,
            "colorScheme": if scheme.is_empty() { "no-preference" } else { scheme.as_str() },
            "media": if media.is_empty() { "screen" } else { media.as_str() },
        }))
    })
}

pub(super) fn pdf(view: &Webview) -> Started<Vec<u8>> {
    let view = view.clone();
    spawn(async move {
        let printed = devtools(
            &view,
            "Page.printToPDF",
            json!({"printBackground": true, "preferCSSPageSize": true}),
        )
        .await?;
        let data = printed["data"].as_str().ok_or("WebView2 made no PDF.")?;
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| "WebView2's PDF couldn't be read.".into())
    })
}

pub(super) fn set_zoom(view: &Webview, zoom: f64) -> Result<(), String> {
    view.with_webview(move |platform| {
        // SAFETY: the live controller, on its UI thread.
        let _ = unsafe { platform.controller().SetZoomFactor(zoom) };
    })
    .map_err(|error| error.to_string())
}

struct Held {
    kind: &'static str,
    message: String,
    default_text: Option<String>,
    args: ICoreWebView2ScriptDialogOpeningEventArgs,
    deferral: ICoreWebView2Deferral,
}

#[derive(Default)]
struct Tab {
    installed: bool,
    holding: bool,
    held: Option<Held>,
}

thread_local! {
    static TABS: RefCell<HashMap<String, Tab>> = RefCell::new(HashMap::new());
}

fn kind_of(kind: COREWEBVIEW2_SCRIPT_DIALOG_KIND) -> &'static str {
    if kind == COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT {
        "alert"
    } else if kind == COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT {
        "prompt"
    } else if kind == COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD {
        "beforeunload"
    } else {
        "confirm"
    }
}

fn on_ui<T: Send + 'static>(
    view: &Webview,
    work: impl FnOnce(&tauri::webview::PlatformWebview, &str) -> T + Send + 'static,
) -> Started<T> {
    let (done, receiver) = reply::<T>();
    let label = view.label().to_owned();
    view.with_webview(move |platform| done(Ok(work(&platform, &label))))
        .map_err(|error| error.to_string())?;
    Ok(receiver)
}

pub(super) fn hold_dialogs(view: &Webview, on: bool) -> Started<()> {
    on_ui(view, move |platform, label| {
        // SAFETY: the live controller and its settings, on the UI thread.
        let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
            return;
        };
        let installed = TABS.with(|tabs| tabs.borrow().get(label).is_some_and(|tab| tab.installed));
        if !installed {
            let own = label.to_owned();
            let handler = ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let holding = TABS.with(|tabs| {
                    tabs.borrow().get(&own).is_some_and(|tab| tab.holding && tab.held.is_none())
                });
                if !holding {
                    return Ok(());
                }
                // SAFETY: the event's own arguments, read on the UI thread during the event.
                unsafe {
                    let mut kind = COREWEBVIEW2_SCRIPT_DIALOG_KIND::default();
                    args.Kind(&mut kind)?;
                    let kind = kind_of(kind);
                    let message = owned_string(|text| args.Message(text)).unwrap_or_default();
                    let default_text = (kind == "prompt")
                        .then(|| owned_string(|text| args.DefaultText(text)))
                        .flatten();
                    let deferral = args.GetDeferral()?;
                    TABS.with(|tabs| {
                        tabs.borrow_mut().entry(own.clone()).or_default().held = Some(Held {
                            kind,
                            message: message.chars().take(500).collect(),
                            default_text,
                            args: args.clone(),
                            deferral,
                        });
                    });
                }
                super::dialog_held();
                Ok(())
            }));
            let mut token = 0i64;
            // SAFETY: registering an event handler on the live view, on the UI thread.
            if unsafe { core.add_ScriptDialogOpening(&handler, &mut token) }.is_ok() {
                TABS.with(|tabs| tabs.borrow_mut().entry(label.to_owned()).or_default().installed = true);
            }
        }
        // SAFETY: the live view's settings, on the UI thread.
        if let Ok(settings) = unsafe { core.Settings() } {
            let _ = unsafe { settings.SetAreDefaultScriptDialogsEnabled(!on) };
        }
        TABS.with(|tabs| tabs.borrow_mut().entry(label.to_owned()).or_default().holding = on);
    })
}

pub(super) fn held_dialog(view: &Webview) -> Started<Option<Value>> {
    on_ui(view, |_, label| {
        TABS.with(|tabs| {
            tabs.borrow().get(label).and_then(|tab| tab.held.as_ref()).map(|held| {
                let mut described = json!({"kind": held.kind, "message": held.message, "held": true});
                if let Some(text) = &held.default_text {
                    described["defaultText"] = json!(text);
                }
                described
            })
        })
    })
}

pub(super) fn answer_dialog(view: &Webview, accept: bool, text: Option<String>) -> Started<Option<Value>> {
    on_ui(view, move |_, label| {
        let held = TABS.with(|tabs| tabs.borrow_mut().get_mut(label).and_then(|tab| tab.held.take()))?;
        let mut answered = json!({"kind": held.kind, "message": held.message, "accepted": accept || held.kind == "alert"});
        // SAFETY: the held event's arguments and deferral, completed on the UI thread.
        unsafe {
            if held.kind == "prompt" && accept {
                let given = text.or(held.default_text).unwrap_or_default();
                let _ = held.args.SetResultText(&HSTRING::from(given.as_str()));
                answered["text"] = json!(given);
            }
            if accept || held.kind == "alert" {
                let _ = held.args.Accept();
            }
            let _ = held.deferral.Complete();
        }
        Some(answered)
    })
}
