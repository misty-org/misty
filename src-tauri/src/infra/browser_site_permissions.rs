//! Native website permissions. Decisions are local to this app and data-store profile.
#![allow(unexpected_cfgs)]
use objc::{msg_send, sel, sel_impl};
use objc2_foundation::{NSProcessInfo, NSString, NSUserDefaults};
use objc2_web_kit::{WKMediaCaptureState, WKSecurityOrigin, WKWebView};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager, Webview};

const DELEGATE_CLASS: &str = "MistySitePermissionDelegate";
const PREFERENCES_KEY: &str = "misty.browser.site-permissions.v1";

#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    #[default]
    Ask,
    Allow,
    Block,
}

#[derive(Clone, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Permissions {
    pub camera: Decision,
    pub microphone: Decision,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPermission {
    pub profile: String,
    pub origin: String,
    pub permissions: Permissions,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteInfo {
    url: String,
    origin: String,
    secure: bool,
    persistent: bool,
    profile: Option<String>,
    permissions: Permissions,
}

type PermissionStore = BTreeMap<String, BTreeMap<String, Permissions>>;

fn canonical_origin(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value).map_err(|_| "Invalid website address.")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Site permissions are available for HTTP and HTTPS websites.".into());
    }
    Ok(url.origin().ascii_serialization())
}

fn read_store() -> PermissionStore {
    NSUserDefaults::standardUserDefaults()
        .stringForKey(&NSString::from_str(PREFERENCES_KEY))
        .and_then(|raw| serde_json::from_str(&raw.to_string()).ok())
        .unwrap_or_default()
}

fn write_store(store: &PermissionStore) -> Result<(), String> {
    let data = serde_json::to_string(store).map_err(|error| error.to_string())?;
    unsafe {
        NSUserDefaults::standardUserDefaults().setObject_forKey(
            Some(&NSString::from_str(&data)),
            &NSString::from_str(PREFERENCES_KEY),
        );
    }
    Ok(())
}

unsafe fn profile(view: &WKWebView) -> Option<String> {
    let store = view.configuration().websiteDataStore();
    // The identifier selector was added in macOS 14. Ephemeral stores never persist choices.
    if !store.isPersistent()
        || NSProcessInfo::processInfo()
            .operatingSystemVersion()
            .majorVersion
            < 14
    {
        return None;
    }
    store.identifier().map(|id| id.UUIDString().to_string())
}

unsafe fn current_origin(view: &WKWebView) -> Result<String, String> {
    canonical_origin(
        &view
            .URL()
            .ok_or("The page has no website address.")?
            .absoluteString()
            .ok_or("The page has no website address.")?
            .to_string(),
    )
}

fn decision(permissions: &Permissions, capture_type: usize, same_origin: bool) -> usize {
    // WKPermissionDecision: Prompt=0, Grant=1, Deny=2. Unknown resource types fail closed.
    let requested = match capture_type {
        0 => vec![permissions.camera],
        1 => vec![permissions.microphone],
        2 => vec![permissions.camera, permissions.microphone],
        _ => return 2,
    };
    if requested.contains(&Decision::Block) {
        2
    } else if same_origin && requested.iter().all(|value| *value == Decision::Allow) {
        1
    } else {
        0
    }
}

fn effective_permissions(top: &Permissions, requester: &Permissions) -> Permissions {
    Permissions {
        camera: if top.camera == Decision::Block {
            Decision::Block
        } else {
            requester.camera
        },
        microphone: if top.microphone == Decision::Block {
            Decision::Block
        } else {
            requester.microphone
        },
    }
}

extern "C" fn media_permission(
    _delegate: &objc::runtime::Object,
    _selector: objc::runtime::Sel,
    webview: *mut objc::runtime::Object,
    origin: *mut objc::runtime::Object,
    _frame: *mut objc::runtime::Object,
    capture_type: usize,
    handler: *mut objc::runtime::Object,
) {
    unsafe {
        let view = &*webview.cast::<WKWebView>();
        let requester = &*origin.cast::<WKSecurityOrigin>();
        let host = requester.host().to_string();
        let host = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host
        };
        let port = requester.port();
        let suffix = if port > 0 {
            format!(":{port}")
        } else {
            String::new()
        };
        let requester = canonical_origin(&format!("{}://{host}{suffix}", requester.protocol()));
        let top = current_origin(view);
        let profile_id = profile(view);
        let store = read_store();
        let sites = profile_id.as_ref().and_then(|id| store.get(id));
        let top_permissions = sites
            .and_then(|sites| top.as_ref().ok().and_then(|origin| sites.get(origin)))
            .cloned()
            .unwrap_or_default();
        let requesting_permissions = sites
            .and_then(|sites| requester.as_ref().ok().and_then(|origin| sites.get(origin)))
            .cloned()
            .unwrap_or_default();
        let permissions = effective_permissions(&top_permissions, &requesting_permissions);
        // A top-level allowance never silently grants capture to an embedded third party.
        let same_origin =
            matches!((&top, &requester), (Ok(top), Ok(requester)) if top == requester);
        let result = if top.is_err() || requester.is_err() {
            2
        } else {
            decision(&permissions, capture_type, same_origin)
        };
        (&*handler.cast::<block2::Block<dyn Fn(usize)>>()).call((result,));
    }
}

pub(super) fn install(webview: &Webview) -> Result<(), String> {
    webview.with_webview(|native| unsafe {
        let view = native.inner() as *mut objc::runtime::Object;
        let delegate: *mut objc::runtime::Object = msg_send![view, UIDelegate];
        if delegate.is_null() || (*delegate).class().name() == DELEGATE_CLASS { return; }
        let subclass = objc::runtime::Class::get(DELEGATE_CLASS).unwrap_or_else(|| {
            let mut declaration = objc::declare::ClassDecl::new(DELEGATE_CLASS, (*delegate).class())
                .expect("unique site permission delegate class");
            declaration.add_method(sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:),
                media_permission as extern "C" fn(&objc::runtime::Object, objc::runtime::Sel,
                    *mut objc::runtime::Object, *mut objc::runtime::Object, *mut objc::runtime::Object, usize, *mut objc::runtime::Object));
            declaration.register()
        });
        extern "C" { fn object_setClass(object: *mut objc::runtime::Object, class: *const objc::runtime::Class) -> *const objc::runtime::Class; }
        // Same-size subclass preserves Wry's upload and popup delegate behavior.
        object_setClass(delegate, subclass);
        let _: () = msg_send![view, setUIDelegate: std::ptr::null_mut::<objc::runtime::Object>()];
        let _: () = msg_send![view, setUIDelegate: delegate];
    }).map_err(|error| error.to_string())
}

fn require_host(caller: &Webview) -> Result<(), String> {
    if caller.label() != "main" && !caller.label().starts_with("misty-agent-") {
        return Err("Only Misty's settings can change website permissions.".into());
    }
    Ok(())
}

fn target(app: &AppHandle, id: &str) -> Result<Webview, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Invalid browser tab.".into());
    }
    app.get_webview(&format!("misty-browser-{id}"))
        .ok_or("This browser tab has closed.".into())
}

async fn inspect(
    view: Webview,
    expected_origin: Option<String>,
    update: Option<Permissions>,
) -> Result<SiteInfo, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| unsafe {
        let result = (|| {
            let view: &WKWebView = &*native.inner().cast();
            let origin = current_origin(view)?;
            if expected_origin
                .as_ref()
                .is_some_and(|expected| expected != &origin)
            {
                return Err("The page changed. Reopen site settings and try again.".into());
            }
            let profile = profile(view);
            let mut store = read_store();
            if let Some(update) = update {
                let profile = profile
                    .as_ref()
                    .ok_or("This temporary website session cannot remember permissions.")?;
                if update == Permissions::default() {
                    if let Some(sites) = store.get_mut(profile) {
                        sites.remove(&origin);
                    }
                } else {
                    store
                        .entry(profile.clone())
                        .or_default()
                        .insert(origin.clone(), update);
                }
                write_store(&store)?;
            }
            let permissions = profile
                .as_ref()
                .and_then(|id| store.get(id))
                .and_then(|sites| sites.get(&origin))
                .cloned()
                .unwrap_or_default();
            Ok(SiteInfo {
                url: view
                    .URL()
                    .unwrap()
                    .absoluteString()
                    .ok_or("The page has no website address.")?
                    .to_string(),
                origin,
                secure: view.hasOnlySecureContent()
                    && view
                        .URL()
                        .unwrap()
                        .scheme()
                        .is_some_and(|s| s.to_string() == "https"),
                persistent: profile.is_some(),
                profile,
                permissions,
            })
        })();
        let _ = tx.send(result);
    })
    .map_err(|error| error.to_string())?;
    rx.await
        .map_err(|_| "The browser closed while reading site settings.".to_owned())?
}

#[tauri::command]
pub async fn browser_site_info(
    caller: Webview,
    app: AppHandle,
    id: String,
) -> Result<SiteInfo, String> {
    require_host(&caller)?;
    inspect(target(&app, &id)?, None, None).await
}

// Stop capture in every browser view. This includes third-party frames and other tabs
// whose current top-level URL does not reveal the origin of an active media stream.
async fn stop_capture(
    app: &AppHandle,
    affected_profile: &str,
    camera: bool,
    microphone: bool,
) -> Result<(), String> {
    let mut receivers = Vec::new();
    for (label, webview) in app.webviews() {
        if !label.starts_with("misty-browser-") {
            continue;
        }
        for is_camera in [true, false] {
            if (is_camera && !camera) || (!is_camera && !microphone) {
                continue;
            }
            let (tx, rx) = tokio::sync::oneshot::channel();
            let affected_profile = affected_profile.to_owned();
            webview
                .with_webview(move |native| unsafe {
                    let view: &WKWebView = &*native.inner().cast();
                    if profile(view).as_deref() != Some(&affected_profile) {
                        let _ = tx.send(());
                        return;
                    }
                    let tx = std::cell::RefCell::new(Some(tx));
                    let done = block2::RcBlock::new(move || {
                        if let Some(tx) = tx.borrow_mut().take() {
                            let _ = tx.send(());
                        }
                    });
                    if is_camera {
                        view.setCameraCaptureState_completionHandler(
                            WKMediaCaptureState::None,
                            Some(&done),
                        );
                    } else {
                        view.setMicrophoneCaptureState_completionHandler(
                            WKMediaCaptureState::None,
                            Some(&done),
                        );
                    }
                })
                .map_err(|error| error.to_string())?;
            receivers.push(rx);
        }
    }
    for rx in receivers {
        tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .map_err(|_| {
                "Permission saved, but stopping capture timed out. Close affected tabs.".to_owned()
            })?
            .map_err(|_| "The tab closed while stopping capture.".to_owned())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_site_permissions_set(
    caller: Webview,
    app: AppHandle,
    id: String,
    origin: String,
    permissions: Permissions,
) -> Result<SiteInfo, String> {
    require_host(&caller)?;
    let before = inspect(target(&app, &id)?, Some(canonical_origin(&origin)?), None).await?;
    let info = inspect(
        target(&app, &id)?,
        Some(canonical_origin(&origin)?),
        Some(permissions.clone()),
    )
    .await?;
    if let Some(profile) = &info.profile {
        stop_capture(
            &app,
            profile,
            permissions.camera != Decision::Allow
                && permissions.camera != before.permissions.camera,
            permissions.microphone != Decision::Allow
                && permissions.microphone != before.permissions.microphone,
        )
        .await?;
    }
    Ok(info)
}

async fn active_profiles(app: &AppHandle) -> Result<std::collections::HashSet<String>, String> {
    let mut profiles = std::collections::HashSet::new();
    for (label, webview) in app.webviews() {
        if !label.starts_with("misty-browser-") {
            continue;
        }
        let (tx, rx) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |native| unsafe {
                let view: &WKWebView = &*native.inner().cast();
                let _ = tx.send(profile(view));
            })
            .map_err(|error| error.to_string())?;
        if let Some(profile) = rx.await.map_err(|_| "Browser profile closed.")? {
            profiles.insert(profile);
        }
    }
    Ok(profiles)
}

#[tauri::command]
pub async fn browser_site_permissions_list(
    caller: Webview,
    app: AppHandle,
) -> Result<Vec<SavedPermission>, String> {
    require_host(&caller)?;
    // Do not expose origins belonging to a different signed-in account's dormant profiles.
    let active = active_profiles(&app).await?;
    Ok(read_store()
        .into_iter()
        .filter(|(profile, _)| active.contains(profile))
        .flat_map(|(profile, sites)| {
            sites
                .into_iter()
                .map(move |(origin, permissions)| SavedPermission {
                    profile: profile.clone(),
                    origin,
                    permissions,
                })
        })
        .collect())
}

#[tauri::command]
pub async fn browser_site_permissions_reset(
    caller: Webview,
    app: AppHandle,
    profile: String,
    origin: String,
) -> Result<(), String> {
    require_host(&caller)?;
    let origin = canonical_origin(&origin)?;
    if !active_profiles(&app).await?.contains(&profile) {
        return Err("Open a tab in this browser profile before resetting its permissions.".into());
    }
    // Serialize all NSUserDefaults read/modify/write operations on the main thread.
    let (tx, rx) = tokio::sync::oneshot::channel();
    let affected_profile = profile.clone();
    app.run_on_main_thread(move || {
        let mut store = read_store();
        if let Some(sites) = store.get_mut(&profile) {
            sites.remove(&origin);
        }
        let _ = tx.send(write_store(&store));
    })
    .map_err(|error| error.to_string())?;
    rx.await
        .map_err(|_| "Could not reset website permissions.".to_owned())??;
    stop_capture(&app, &affected_profile, true, true).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_identity_preserves_scheme_host_and_nondefault_port() {
        assert_eq!(
            canonical_origin("https://user:pass@EXAMPLE.com:443/path?q=x").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            canonical_origin("https://example.com:8443/").unwrap(),
            "https://example.com:8443"
        );
        assert_eq!(
            canonical_origin("http://[::1]:3000/").unwrap(),
            "http://[::1]:3000"
        );
        assert!(canonical_origin("file:///tmp/page.html").is_err());
        assert!(canonical_origin("javascript:alert(1)").is_err());
    }
    #[test]
    fn prompts_by_default_and_never_inherits_an_allowance_into_another_origin() {
        assert_eq!(decision(&Permissions::default(), 2, true), 0);
        let allowed = Permissions {
            camera: Decision::Allow,
            microphone: Decision::Allow,
        };
        assert_eq!(decision(&allowed, 2, true), 1);
        assert_eq!(decision(&allowed, 2, false), 0);
        assert_eq!(decision(&allowed, 99, true), 2);
    }
    #[test]
    fn saved_requester_blocks_apply_inside_frames_and_top_blocks_override_requester_allows() {
        let blocked = Permissions {
            camera: Decision::Block,
            microphone: Decision::Ask,
        };
        let allowed = Permissions {
            camera: Decision::Allow,
            microphone: Decision::Allow,
        };
        assert_eq!(
            decision(
                &effective_permissions(&Permissions::default(), &blocked),
                0,
                false
            ),
            2
        );
        assert_eq!(
            decision(&effective_permissions(&blocked, &allowed), 0, false),
            2
        );
        assert_eq!(
            decision(
                &effective_permissions(&Permissions::default(), &allowed),
                0,
                false
            ),
            0
        );
    }

    #[test]
    fn combined_requests_require_both_grants_and_block_wins() {
        let partial = Permissions {
            camera: Decision::Allow,
            microphone: Decision::Ask,
        };
        assert_eq!(decision(&partial, 0, true), 1);
        assert_eq!(decision(&partial, 2, true), 0);
        let blocked = Permissions {
            camera: Decision::Allow,
            microphone: Decision::Block,
        };
        assert_eq!(decision(&blocked, 2, true), 2);
        assert_eq!(decision(&blocked, 1, false), 2);
    }
}
