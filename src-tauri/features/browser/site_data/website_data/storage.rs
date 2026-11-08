//! Native transport for website storage. Plaintext stays between the website's own origin and
//! the native records; it never crosses the Misty renderer bridge.
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
#[cfg(windows)]
use tauri::Manager;
use tauri::Webview;

const SCRIPT: &str = include_str!("storage.js");
mod evaluate;
pub(crate) use evaluate::{read_page, write_page, PageStorage, StorageError};

/// A hidden, inert document on one origin. It runs no website script and makes no request, so
/// reading or writing a site's storage never refreshes its cookies or races its pages. It
/// closes when dropped; if the window holding it closes first, it is simply gone and the next
/// operation says so.
pub(crate) struct InertOrigin(Webview);

impl Drop for InertOrigin {
    fn drop(&mut self) {
        let _ = self.0.close();
    }
}

impl InertOrigin {
    /// Opens `origin` in a store, held by `owner`: any window can hold it, since the store, not
    /// the window, decides whose data it reaches.
    pub(crate) async fn open(
        owner: &tauri::Window,
        physical: &str,
        origin: &str,
    ) -> Result<Self, String> {
        let url: url::Url = "about:blank".parse().map_err(|_| "Invalid storage URL")?;
        let expected = origin.to_owned();
        let builder = tauri::WebviewBuilder::new(
            format!("misty-browser-storage-{}", uuid::Uuid::new_v4()),
            tauri::WebviewUrl::External(url),
        )
        .focused(false)
        .on_navigation(move |url| {
            url.as_str() == "about:blank" || url.origin().ascii_serialization() == expected
        });
        // Windows answers the document's request with nothing, so its content is written here. Mac
        // loads the content directly in `open_origin`, and rewriting it mid-parse wedges it.
        #[cfg(windows)]
        let builder = builder.initialization_script(format!(
            "if (window === top && location.origin === {}) {{ window.stop(); document.open(); document.write('<!doctype html><title>Misty storage</title>'); document.close(); }}",
            serde_json::to_string(origin).map_err(|_| "Invalid website origin")?
        ));
        #[cfg(target_os = "macos")]
        let builder = builder.data_store_identifier(
            super::super::profile_store::data_store_identifier(Some(physical))?,
        );
        #[cfg(windows)]
        let builder = crate::browser::with_store_data(builder, owner.app_handle(), Some(physical))?;
        let created = {
            let _creating = crate::browser::pages::creation_guard::Creating::enter();
            owner.add_child(
                builder,
                tauri::LogicalPosition::new(-10000., -10000.),
                tauri::LogicalSize::new(1., 1.),
            )
        };
        let view = Self(created.map_err(|_| "Could not open website storage")?);
        view.0
            .hide()
            .map_err(|_| "Could not hide website storage")?;
        open_origin(&view.0, origin).await?;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if view
                .0
                .url()
                .is_ok_and(|url| url.origin().ascii_serialization() == origin)
                && evaluate::ready(&view.0, origin).await
            {
                return Ok(view);
            }
            if tokio::time::Instant::now() > deadline {
                return Err("Website storage connection timed out".into());
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    pub(crate) fn view(&self) -> &Webview {
        &self.0
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
