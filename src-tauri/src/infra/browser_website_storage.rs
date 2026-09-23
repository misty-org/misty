//! Native transport for website storage. Plaintext stays between the website's
//! own origin and the native vault; it never crosses the Misty renderer bridge.
use misty_browser_sync::{
    document::{credentials::Area, CredentialRecord},
    store::BrowserObservation,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::{Manager, Webview};

const SCRIPT: &str = include_str!("browser_website_storage.js");

async fn evaluate(
    view: &Webview,
    physical: &str,
    origin: &str,
    write: Option<Value>,
) -> Result<Value, String> {
    let url = view.url().map_err(|_| "Website storage is unavailable")?;
    if url.origin().ascii_serialization() != origin {
        return Err("Website navigated during sync".into());
    }
    // Verify the real store without the about:blank-only cookie-import guard.
    // WebView2 verifies its native profile inside evaluate_storage below.
    #[cfg(target_os = "macos")]
    super::browser_cookie_store::verify_storage_profile(view, physical)
        .await
        .map_err(|_| "Website profile could not be verified")?;
    let request = serde_json::to_string(&json!({"origin":origin, "write":write}))
        .map_err(|_| "Invalid website storage request")?;
    let script = SCRIPT.replace("__MISTY_STORAGE_REQUEST__", &request);
    #[cfg(target_os = "macos")]
    let raw = super::browser_macos::evaluate_browser_async_javascript(view.clone(), script)
        .await
        .map_err(|_| "This website's storage could not be transferred")?;
    #[cfg(windows)]
    let raw = super::browser_cookie_store::evaluate_storage(view, physical, script)
        .await
        .map_err(|_| "This website's storage could not be transferred")?;
    let raw = zeroize::Zeroizing::new(raw);
    if raw.len() > 8 << 20 {
        return Err("Website storage exceeds the sync limit".into());
    }
    let value: Value = serde_json::from_str(&raw).map_err(|_| "Invalid website storage")?;
    if value["origin"].as_str() != Some(origin) {
        return Err("Website changed origin during sync".into());
    }
    Ok(value)
}

pub(super) async fn capture(
    app: &tauri::AppHandle,
    physical: &str,
    previous: &[CredentialRecord],
    extra: Option<(Webview, Vec<String>)>,
) -> Result<Vec<BrowserObservation>, String> {
    // Keep already captured, closed origins in the complete observation. They
    // cannot be mistaken for deletions merely because their tab isn't mounted.
    let mut areas = BTreeMap::new();
    for record in previous {
        if !matches!(record.area, Area::Cookies) {
            areas.insert(
                record
                    .area
                    .key(&record.profile_id)
                    .map_err(|_| "Invalid website origin")?,
                BrowserObservation {
                    area: record.area.clone(),
                    payload: record.payload.clone(),
                },
            );
        }
    }
    let mut origins = std::collections::BTreeSet::new();
    for (tab_id, view) in super::browser::sync_storage_views(app, physical)? {
        let url = view.url().map_err(|_| "Website storage is unavailable")?;
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let origin = url.origin().ascii_serialization();
        let fresh_origin = origins.insert(origin.clone());
        let value = evaluate(&view, physical, &origin, None).await?;
        let mut fields = vec![(
            Area::SessionStorage {
                origin: origin.clone(),
                tab_id,
            },
            "session",
        )];
        if fresh_origin {
            fields.extend([
                (
                    Area::LocalStorage {
                        origin: origin.clone(),
                    },
                    "local",
                ),
                (Area::IndexedDb { origin }, "indexed"),
            ]);
        }
        for (area, field) in fields {
            let payload = value[field].clone();
            area.validate_payload(&payload)
                .map_err(|_| "Unsupported website storage")?;
            // A fixed valid profile is sufficient to canonicalize this area key.
            let key = area
                .key(&"a".repeat(64))
                .map_err(|_| "Invalid website origin")?;
            areas.retain(|_, old| {
                serde_json::to_value(&old.area).ok() != serde_json::to_value(&area).ok()
            });
            areas.insert(key, BrowserObservation { area, payload });
        }
    }
    if let Some((owner, extra)) = extra {
        let mut storage = WebsiteStorage::new(owner, physical.into());
        for origin in extra {
            if !origins.insert(origin.clone()) {
                continue;
            }
            let view = storage.origin(&origin, None).await?;
            let value = evaluate(view, physical, &origin, None).await?;
            for (area, field) in [
                (
                    Area::LocalStorage {
                        origin: origin.clone(),
                    },
                    "local",
                ),
                (Area::IndexedDb { origin }, "indexed"),
            ] {
                let payload = value[field].clone();
                area.validate_payload(&payload)
                    .map_err(|_| "Unsupported website storage")?;
                areas.insert(
                    area.key(&"a".repeat(64))
                        .map_err(|_| "Invalid website origin")?,
                    BrowserObservation { area, payload },
                );
            }
        }
    }
    Ok(areas.into_values().collect())
}

struct OriginView(Webview);
impl Drop for OriginView {
    fn drop(&mut self) {
        let _ = self.0.close();
    }
}

/// A minimal origin document prevents website scripts from racing an import.
/// Website pages are opened only after native storage readback has completed.
pub(super) struct WebsiteStorage {
    owner: Webview,
    physical: String,
    origins: BTreeMap<String, OriginView>,
}
impl WebsiteStorage {
    pub fn new(owner: Webview, physical: String) -> Self {
        Self {
            owner,
            physical,
            origins: BTreeMap::new(),
        }
    }
    async fn origin(&mut self, origin: &str, tab_id: Option<&str>) -> Result<&Webview, String> {
        let key = serde_json::to_string(&(origin, tab_id)).map_err(|_| "Invalid website origin")?;
        if self.origins.get(&key).is_some_and(|view| {
            self.owner
                .app_handle()
                .get_webview(view.0.label())
                .is_none()
        }) {
            self.origins.remove(&key);
        }
        if !self.origins.contains_key(&key) {
            let url: url::Url = "about:blank".parse().map_err(|_| "Invalid storage URL")?;
            let expected = origin.to_owned();
            let script = format!(
                "if (window === top && location.origin === {}) {{ window.stop(); document.open(); document.write('<!doctype html><title>Misty storage</title>'); document.close(); globalThis.__mistyStorageReady = true; }}",
                serde_json::to_string(origin).map_err(|_| "Invalid website origin")?
            );
            let builder = tauri::WebviewBuilder::new(
                format!("misty-browser-storage-{}", uuid::Uuid::new_v4()),
                tauri::WebviewUrl::External(url),
            )
            .initialization_script(script)
            .on_navigation(move |url| {
                url.as_str() == "about:blank" || url.origin().ascii_serialization() == expected
            });
            #[cfg(target_os = "macos")]
            let builder = builder.data_store_identifier(
                super::browser_profile::data_store_identifier(Some(&self.physical))?,
            );
            #[cfg(windows)]
            let builder = builder.data_directory(super::browser::browser_data_directory(
                self.owner.app_handle(),
                Some(&self.physical),
            )?);
            let view = self
                .owner
                .window()
                .add_child(
                    builder,
                    tauri::LogicalPosition::new(-10000., -10000.),
                    tauri::LogicalSize::new(1., 1.),
                )
                .map_err(|_| "Could not open website storage")?;
            let view = OriginView(view);
            view.0
                .hide()
                .map_err(|_| "Could not hide website storage")?;
            open_origin(&view.0, origin).await?;
            self.origins.insert(key.clone(), view);
        }
        let view = &self
            .origins
            .get(&key)
            .ok_or("Website storage is unavailable")?
            .0;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if view
                .url()
                .is_ok_and(|url| url.origin().ascii_serialization() == origin)
            {
                let script =
                    "return globalThis.__mistyStorageReady === true ? 'ready' : '';".to_owned();
                #[cfg(target_os = "macos")]
                let ready =
                    super::browser_macos::evaluate_browser_async_javascript(view.clone(), script)
                        .await;
                #[cfg(windows)]
                let ready =
                    super::browser_cookie_store::evaluate_storage(view, &self.physical, script)
                        .await
                        .map_err(|_| "Website storage is not ready".to_string());
                if ready.is_ok_and(|value| value == "ready") {
                    break;
                }
            }
            if tokio::time::Instant::now() > deadline {
                return Err("Website storage connection timed out".into());
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        Ok(view)
    }
    pub async fn apply(&mut self, target: &[CredentialRecord]) -> Result<(), String> {
        let mut values: BTreeMap<(String, Option<String>), serde_json::Map<String, Value>> =
            BTreeMap::new();
        for record in target {
            let (origin, tab, field) = match &record.area {
                Area::LocalStorage { origin } => (origin, None, "local"),
                Area::IndexedDb { origin } => (origin, None, "indexed"),
                Area::SessionStorage { origin, tab_id } => {
                    (origin, Some(tab_id.clone()), "session")
                }
                Area::Cookies => continue,
            };
            values
                .entry((origin.clone(), tab))
                .or_default()
                .insert(field.into(), record.payload.clone());
        }
        for ((origin, tab), write) in values {
            let physical = self.physical.clone();
            let view = self.origin(&origin, tab.as_deref()).await?;
            evaluate(view, &physical, &origin, Some(Value::Object(write))).await?;
        }
        Ok(())
    }
    pub async fn readback(
        &mut self,
        target: &[CredentialRecord],
    ) -> Result<Vec<CredentialRecord>, String> {
        let mut values = BTreeMap::new();
        let mut observed = vec![];
        for record in target {
            let (origin, tab, field) = match &record.area {
                Area::LocalStorage { origin } => (origin, None, "local"),
                Area::IndexedDb { origin } => (origin, None, "indexed"),
                Area::SessionStorage { origin, tab_id } => {
                    (origin, Some(tab_id.as_str()), "session")
                }
                Area::Cookies => continue,
            };
            let key = (origin.clone(), tab.map(str::to_owned));
            if !values.contains_key(&key) {
                let physical = self.physical.clone();
                let view = self.origin(origin, tab).await?;
                values.insert(key.clone(), evaluate(view, &physical, origin, None).await?);
            }
            let mut record = record.clone();
            record.payload = values[&key][field].clone();
            observed.push(record);
        }
        Ok(observed)
    }
}

/// Build an inert same-origin document without making a website request or
/// executing its scripts. Importing storage must not refresh server cookies.
async fn open_origin(view: &Webview, origin: &str) -> Result<(), String> {
    let origin = origin.to_owned();
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        #[cfg(target_os = "macos")]
        let result = unsafe {
            use objc2_foundation::{NSString, NSURL};
            let view: &objc2_web_kit::WKWebView = &*platform.inner().cast();
            if let Some(url) = NSURL::URLWithString(&NSString::from_str(&format!("{origin}/"))) {
                view.loadHTMLString_baseURL(&NSString::from_str("<!doctype html><title>Misty storage</title>"), Some(&url));
                Ok(())
            } else { Err("Invalid website origin") }
        };
        #[cfg(windows)]
        let result = unsafe { (|| -> windows::core::Result<()> {
            use webview2_com::{WebResourceRequestedEventHandler, Microsoft::Web::WebView2::Win32::{ICoreWebView2_2, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL}};
            use windows::core::{Interface, HSTRING};
            let view = platform.controller().CoreWebView2()?;
            let environment = view.cast::<ICoreWebView2_2>()?.Environment()?;
            // This private helper has no other purpose. Intercept every request
            // so neither a worker nor a subresource can reach the network.
            view.AddWebResourceRequestedFilter(&HSTRING::from("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
            let callback = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let response = environment.CreateWebResourceResponse(None::<&windows::Win32::System::Com::IStream>, 200,
                        &HSTRING::from("OK"), &HSTRING::from("Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"))?;
                    args.SetResponse(&response)?;
                }
                Ok(())
            }));
            let mut token = 0;
            view.add_WebResourceRequested(&callback, &mut token)?;
            view.Navigate(&HSTRING::from(format!("{origin}/.well-known/misty-workspace-storage")))?;
            Ok(())
        })().map_err(|_| "Could not prepare website storage") };
        let _ = send.send(result);
    }).map_err(|_| "Could not prepare website storage")?;
    tokio::time::timeout(std::time::Duration::from_secs(10), receive)
        .await
        .map_err(|_| "Website storage preparation timed out")?
        .map_err(|_| "Website storage preparation was interrupted")?
        .map_err(str::to_owned)
}

/// Runs only in the debug SDK harness with freshly generated profile identities.
/// Exercises the real WebKit storage adapter without user cookies or a server.
#[cfg(all(debug_assertions, target_os = "macos"))]
pub(crate) async fn probe(app: tauri::AppHandle) -> Result<String, String> {
    let owner = app.get_webview("main").ok_or("Missing probe window")?;
    let physical = uuid::Uuid::new_v4().simple().to_string().repeat(2);
    let other = uuid::Uuid::new_v4().simple().to_string().repeat(2);
    let origin = "https://sync-fixture.invalid";
    let mut storage = WebsiteStorage::new(owner.clone(), physical.clone());
    let view = storage.origin(origin, None).await?;
    if super::browser_cookie_store::verify_storage_profile(view, &other).await.is_ok() {
        return Err("Website storage accepted the wrong profile".into());
    }
    if super::browser_cookie_store::preflight(view, &physical, vec![]).await.is_ok() {
        return Err("Cookie import accepted an origin document".into());
    }
    let written = evaluate(view, &physical, origin, Some(json!({
        "local": {"sync-probe": "persisted"},
        "session": {"sync-probe": "tab-only"},
        "indexed": {"codec_version": 1, "databases": []}
    }))).await?;
    if written["local"]["sync-probe"] != "persisted" || written["session"]["sync-probe"] != "tab-only" {
        return Err("Website storage round trip failed".into());
    }
    let observed = capture(&app, &physical, &[], Some((owner.clone(), vec![origin.into()]))).await?;
    if !observed.iter().any(|observation| matches!(observation.area, Area::LocalStorage { .. }) && observation.payload["sync-probe"] == "persisted") {
        return Err("Website capture did not read the stored origin data".into());
    }
    let mut isolated = WebsiteStorage::new(owner, other.clone());
    let view = isolated.origin(origin, None).await?;
    let empty = evaluate(view, &other, origin, None).await?;
    if empty["local"].get("sync-probe").is_some() {
        return Err("Website data leaked across profiles".into());
    }
    Ok("PASS: native website storage writes, reads and captures HTTP(S) origins; wrong profiles and cookie imports on nonblank pages remain rejected; separate profiles remain isolated.".into())
}
