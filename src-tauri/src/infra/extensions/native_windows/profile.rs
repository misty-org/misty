//! WebView2 profile calls: listing, installing, turning off and removing an
//! extension. Each runs on the view's UI thread and waits for WebView2's
//! completion handler.
use std::path::PathBuf;

use tauri::Webview;
use tokio::sync::oneshot;
use webview2_com::{
    take_pwstr, BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2BrowserExtension, ICoreWebView2BrowserExtensionList,
        ICoreWebView2Profile7, ICoreWebView2_13,
    },
    ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
};
use windows::core::{Interface, BOOL, HSTRING, PWSTR};

use super::TIMEOUT;
use crate::infra::webview2::{with_core, CdpError};

pub(super) struct Profile {
    pub(super) path: String,
    pub(super) private: bool,
    /// Installed extension IDs, with whether each is enabled.
    pub(super) installed: Vec<(String, bool)>,
}

pub(super) fn profile_of(core: &ICoreWebView2) -> windows::core::Result<ICoreWebView2Profile7> {
    // SAFETY: a live view on its UI thread.
    unsafe { core.cast::<ICoreWebView2_13>()?.Profile()?.cast() }
}

pub(super) fn id_of(extension: &ICoreWebView2BrowserExtension) -> Option<String> {
    let mut id = PWSTR::null();
    // SAFETY: a live extension; WebView2 allocates `id`.
    unsafe { extension.Id(&mut id) }.ok()?;
    Some(take_pwstr(id))
}

pub(super) fn is_enabled(extension: &ICoreWebView2BrowserExtension) -> bool {
    let mut enabled = BOOL::default();
    // SAFETY: a live extension.
    unsafe { extension.IsEnabled(&mut enabled) }.is_ok() && enabled.as_bool()
}

pub(super) fn extensions(
    list: &ICoreWebView2BrowserExtensionList,
) -> Vec<(String, ICoreWebView2BrowserExtension)> {
    let mut count = 0;
    // SAFETY: the list WebView2 handed to the completion handler.
    if unsafe { list.Count(&mut count) }.is_err() {
        return Vec::new();
    }
    (0..count)
        .filter_map(|index| {
            let extension = unsafe { list.GetValueAtIndex(index) }.ok()?;
            Some((id_of(&extension)?, extension))
        })
        .collect()
}

pub(super) async fn finish<T>(receive: oneshot::Receiver<T>, failure: &str) -> Result<T, String> {
    match tokio::time::timeout(TIMEOUT, receive).await {
        Ok(Ok(value)) => Ok(value),
        _ => Err(failure.to_owned()),
    }
}

pub(super) async fn inspect(view: &Webview) -> Result<Profile, String> {
    let (send, receive) = oneshot::channel();
    with_core(view, move |core, _| {
        let profile = profile_of(core)?;
        let mut path = PWSTR::null();
        let mut private = BOOL::default();
        // SAFETY: a live profile on its UI thread; WebView2 allocates `path`.
        unsafe {
            profile.ProfilePath(&mut path)?;
            profile.IsInPrivateModeEnabled(&mut private)?;
        }
        let path = take_pwstr(path);
        let private = private.as_bool();
        let handler =
            ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |status, list| {
                if let Some(list) = list.filter(|_| status.is_ok()) {
                    let installed = extensions(&list)
                        .into_iter()
                        .map(|(id, extension)| (id, is_enabled(&extension)))
                        .collect();
                    let _ = send.send(Profile {
                        path,
                        private,
                        installed,
                    });
                }
                Ok(())
            }));
        // SAFETY: the handler owns its state.
        unsafe { profile.GetBrowserExtensions(&handler) }.map_err(CdpError::from)
    })
    .await?;
    finish(receive, "Windows could not list this profile's extensions.").await
}

/// Installs the extension from `folder`, over any earlier version, and
/// makes sure it runs.
pub(super) async fn add(view: &Webview, folder: PathBuf) -> Result<(), String> {
    let (send, receive) = oneshot::channel::<bool>();
    with_core(view, move |core, _| {
        let profile = profile_of(core)?;
        let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
            move |status, extension| {
                match extension.filter(|_| status.is_ok()) {
                    Some(extension) if !is_enabled(&extension) => {
                        let enabled = BrowserExtensionEnableCompletedHandler::create(Box::new(
                            move |status| {
                                let _ = send.send(status.is_ok());
                                Ok(())
                            },
                        ));
                        // SAFETY: the extension WebView2 just installed.
                        let _ = unsafe { extension.Enable(true, &enabled) };
                    }
                    Some(_) => {
                        let _ = send.send(true);
                    }
                    None => {}
                }
                Ok(())
            },
        ));
        // SAFETY: the handler owns its state.
        unsafe { profile.AddBrowserExtension(&HSTRING::from(folder.as_os_str()), &handler) }
            .map_err(CdpError::from)
    })
    .await?;
    match finish(receive, "").await {
        Ok(true) => Ok(()),
        _ => Err("Windows could not load this extension.".into()),
    }
}

/// Runs `act` on the profile's extension `crx` and waits for its result;
/// an extension that isn't installed needs nothing.
pub(super) async fn with_extension(
    view: &Webview,
    crx: String,
    act: impl FnOnce(ICoreWebView2BrowserExtension, oneshot::Sender<bool>) + 'static + Send,
) -> Result<bool, String> {
    let (send, receive) = oneshot::channel::<bool>();
    with_core(view, move |core, _| {
        let profile = profile_of(core)?;
        let handler =
            ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |status, list| {
                let found = list
                    .filter(|_| status.is_ok())
                    .and_then(|list| extensions(&list).into_iter().find(|(id, _)| *id == crx));
                match found {
                    Some((_, extension)) => act(extension, send),
                    None => {
                        let _ = send.send(true);
                    }
                }
                Ok(())
            }));
        // SAFETY: the handler owns its state.
        unsafe { profile.GetBrowserExtensions(&handler) }.map_err(CdpError::from)
    })
    .await?;
    Ok(finish(receive, "").await.unwrap_or(false))
}

pub(super) async fn set_enabled(view: &Webview, crx: String, enabled: bool) -> Result<(), String> {
    let done = with_extension(view, crx, move |extension, send| {
        if is_enabled(&extension) == enabled {
            let _ = send.send(true);
            return;
        }
        let handler = BrowserExtensionEnableCompletedHandler::create(Box::new(move |status| {
            let _ = send.send(status.is_ok());
            Ok(())
        }));
        // SAFETY: an extension from this profile's list; on failure the
        // handler drops and the caller sees the failure.
        let _ = unsafe { extension.Enable(enabled, &handler) };
    })
    .await?;
    done.then_some(())
        .ok_or_else(|| "Windows could not turn this extension off.".into())
}

pub(super) async fn remove(view: &Webview, crx: String) -> Result<(), String> {
    let done = with_extension(view, crx, |extension, send| {
        let handler = BrowserExtensionRemoveCompletedHandler::create(Box::new(move |status| {
            let _ = send.send(status.is_ok());
            Ok(())
        }));
        // SAFETY: an extension from this profile's list; on failure the
        // handler drops and the caller sees the failure.
        let _ = unsafe { extension.Remove(&handler) };
    })
    .await?;
    done.then_some(())
        .ok_or_else(|| "Windows could not remove this extension.".into())
}
