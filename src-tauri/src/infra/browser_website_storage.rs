//! Native transport for website storage. Plaintext stays between the website's
//! own origin and the native vault; it never crosses the Misty renderer bridge.
use super::browser_data_budget::Held;
use super::browser_signin_scope::with_unsynced;
use misty_browser_sync::document::{credentials::Area, CredentialRecord};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::{Manager, Webview};

const SCRIPT: &str = include_str!("browser_website_storage.js");
/// Reading another profile's store is never skipped past: it aborts capture.
pub(super) const PROFILE_UNVERIFIED: &str = "Website profile could not be verified";

pub(super) async fn evaluate(
    view: &Webview,
    physical: &str,
    origin: &str,
    write: Option<Value>,
) -> Result<Value, String> {
    evaluate_request(
        view,
        physical,
        origin,
        json!({"origin":origin, "write":write}),
    )
    .await
}

/// A periodic read: `read` names the areas wanted and `known` the stamps of
/// what the caller already holds. Areas whose stamp still matches come back
/// listed in `unchanged` instead of exported again.
pub(super) async fn evaluate_read(
    view: &Webview,
    physical: &str,
    origin: &str,
    read: Value,
    known: Value,
) -> Result<Value, String> {
    evaluate_request(
        view,
        physical,
        origin,
        json!({"origin":origin, "write":null, "read":read, "known":known}),
    )
    .await
}

async fn evaluate_request(
    view: &Webview,
    physical: &str,
    origin: &str,
    mut request: Value,
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
        .map_err(|_| PROFILE_UNVERIFIED)?;
    request["scope"] = super::browser_signin_scope::page_scope();
    let request = serde_json::to_string(&request).map_err(|_| "Invalid website storage request")?;
    let script = SCRIPT.replace("__MISTY_STORAGE_REQUEST__", &request);
    #[cfg(target_os = "macos")]
    let raw = super::browser_macos::evaluate_browser_async_javascript(view.clone(), script)
        .await
        .map_err(|_| "This website's storage could not be transferred")?;
    #[cfg(windows)]
    let raw = super::browser_cookie_store::evaluate_storage(view, physical, script)
        .await
        .map_err(|error| match error {
            super::browser_cookie_store::CookieStoreError::Profile => PROFILE_UNVERIFIED,
            _ => "This website's storage could not be transferred",
        })?;
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
    held: Held,
}
impl WebsiteStorage {
    pub fn new(owner: Webview, physical: String) -> Self {
        Self {
            owner,
            physical,
            origins: BTreeMap::new(),
            held: Held::default(),
        }
    }
    /// Local data that could not sync keeps its local value: restore neither
    /// writes its synced stand-in nor reports a difference on readback.
    pub fn with_held(mut self, held: Held) -> Self {
        self.held = held;
        self
    }
    pub(super) async fn origin_view(&mut self, origin: &str) -> Result<&Webview, String> {
        self.origin(origin, None).await
    }
    async fn origin(&mut self, origin: &str, view_id: Option<&str>) -> Result<&Webview, String> {
        let key = serde_json::to_string(&(origin, view_id)).map_err(|_| "Invalid website origin")?;
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
            .focused(false)
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
        for record in target
            .iter()
            .filter(|record| !self.held.holds(&record.area))
        {
            let (origin, tab, field) = match &record.area {
                Area::LocalStorage { origin } => (origin, None, "local"),
                Area::IndexedDb { origin } => (origin, None, "indexed"),
                Area::SessionStorage { origin, view_id } => {
                    (origin, Some(view_id.clone()), "session")
                }
                Area::Cookies => continue,
            };
            let write = values.entry((origin.clone(), tab)).or_default();
            write.insert(field.into(), record.payload.clone());
            if let Some(hold) = self
                .held
                .databases
                .get(origin)
                .filter(|_| field == "indexed")
            {
                write.insert("hold".into(), json!(hold));
            }
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
            if self.held.holds(&record.area) {
                observed.push(record.clone());
                continue;
            }
            let (origin, tab, field) = match &record.area {
                Area::LocalStorage { origin } => (origin, None, "local"),
                Area::IndexedDb { origin } => (origin, None, "indexed"),
                Area::SessionStorage { origin, view_id } => {
                    (origin, Some(view_id.as_str()), "session")
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
            // Storage outside the sign-in scope is never written, so it is not compared.
            let actual = with_unsynced(&record.area, values[&key][field].clone(), &record.payload);
            record.payload = match self
                .held
                .databases
                .get(origin)
                .filter(|_| field == "indexed")
            {
                Some(hold) => with_held_databases(actual, &record.payload, hold),
                None => actual,
            };
            observed.push(record);
        }
        Ok(observed)
    }
}

/// Held databases were not written, so report their synced copies in place of
/// whatever local version the page holds.
fn with_held_databases(
    mut actual: Value,
    target: &Value,
    hold: &std::collections::BTreeSet<String>,
) -> Value {
    let named = |db: &Value| db["name"].as_str().is_some_and(|name| hold.contains(name));
    if let Some(databases) = actual["databases"].as_array_mut() {
        databases.retain(|db| !named(db));
        databases.extend(
            target["databases"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|db| named(db))
                .cloned(),
        );
        databases.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    }
    actual
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
    async fn assert_background(owner: &Webview) -> Result<(), String> {
        let (send, receive) = tokio::sync::oneshot::channel();
        owner
            .with_webview(move |_| {
                let marker =
                    objc2::MainThreadMarker::new().expect("native callback runs on main thread");
                let active = objc2_app_kit::NSApplication::sharedApplication(marker).isActive();
                let _ = send.send(active);
            })
            .map_err(|_| "Could not inspect probe activation")?;
        if receive
            .await
            .map_err(|_| "Could not inspect probe activation")?
        {
            return Err("Background storage activated the application".into());
        }
        Ok(())
    }
    assert_background(&owner).await?;
    let physical = uuid::Uuid::new_v4().simple().to_string().repeat(2);
    let other = uuid::Uuid::new_v4().simple().to_string().repeat(2);
    let origin = "https://sync-fixture.invalid";
    let mut storage = WebsiteStorage::new(owner.clone(), physical.clone());
    let view = storage.origin(origin, None).await?;
    if super::browser_cookie_store::verify_storage_profile(view, &other)
        .await
        .is_ok()
    {
        return Err("Website storage accepted the wrong profile".into());
    }
    if super::browser_cookie_store::preflight(view, &physical, vec![])
        .await
        .is_ok()
    {
        return Err("Cookie import accepted an origin document".into());
    }
    let written = evaluate(
        view,
        &physical,
        origin,
        Some(json!({
            "local": {"sync-probe-token": "persisted"},
            "session": {"sync-probe-token": "tab-only"},
            "indexed": {"codec_version": 1, "databases": []}
        })),
    )
    .await?;
    if written["local"]["sync-probe-token"] != "persisted"
        || written["session"]["sync-probe-token"] != "tab-only"
    {
        return Err("Website storage round trip failed".into());
    }
    let mut coverage = super::browser_data_coverage::Coverage::default();
    let observed = super::browser_website_capture::capture(
        &app,
        &physical,
        &[],
        Some((owner.clone(), vec![origin.into()])),
        &mut coverage,
    )
    .await?;
    if !observed.candidates.iter().any(|candidate| {
        matches!(candidate.area, Area::LocalStorage { .. })
            && candidate
                .fresh
                .as_ref()
                .is_some_and(|payload| payload["sync-probe-token"] == "persisted")
    }) {
        return Err("Website capture did not read the stored origin data".into());
    }
    assert_background(&owner).await?;
    let mut isolated = WebsiteStorage::new(owner.clone(), other.clone());
    let view = isolated.origin(origin, None).await?;
    let empty = evaluate(view, &other, origin, None).await?;
    if empty["local"].get("sync-probe-token").is_some() {
        return Err("Website data leaked across profiles".into());
    }
    assert_background(&owner).await?;
    Ok("PASS: native website storage writes, reads and captures HTTP(S) origins without activating the application; wrong profiles and cookie imports on nonblank pages remain rejected; separate profiles remain isolated.".into())
}
