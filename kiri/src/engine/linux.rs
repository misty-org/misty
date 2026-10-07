//! WebKitGTK on Linux: the permission-request signal and capture state on the
//! view. WebKitGTK has no prompt of its own and does not say which frame
//! asked, so Kiri always asks with a GTK dialog naming the tab's site; only a
//! block is applied silently.

use super::{media_verdict, MediaRequest, PageFacts, Reply, StoreScope};
use crate::permissions::{canonical_origin, MediaKind, Verdict};
use gtk::prelude::*;
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use tauri::Webview;
use webkit2gtk::{
    MediaCaptureState, PermissionRequest, PermissionRequestExt, SettingsExt,
    UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt,
};

/// Native views that already have Kiri's handler.
fn installed() -> &'static Mutex<HashSet<usize>> {
    static INSTALLED: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
    INSTALLED.get_or_init(Mutex::default)
}

fn page_origin(view: &webkit2gtk::WebView) -> Option<String> {
    view.uri().and_then(|url| canonical_origin(&url).ok())
}

fn ask(view: &webkit2gtk::WebView, request: PermissionRequest, origin: &str, kind: MediaKind) {
    let action = match kind {
        MediaKind::Camera => "use your camera",
        MediaKind::Microphone => "use your microphone",
        MediaKind::CameraAndMicrophone => "use your camera and microphone",
    };
    let parent = view
        .toplevel()
        .and_then(|widget| widget.downcast::<gtk::Window>().ok());
    let dialog = gtk::MessageDialog::new(
        parent.as_ref(),
        gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
        gtk::MessageType::Question,
        gtk::ButtonsType::None,
        &format!("{origin} wants to {action}."),
    );
    dialog.add_button("Block", gtk::ResponseType::Reject);
    dialog.add_button("Allow", gtk::ResponseType::Accept);
    dialog.connect_response(move |dialog, response| {
        if response == gtk::ResponseType::Accept {
            request.allow();
        } else {
            request.deny();
        }
        dialog.close();
    });
    dialog.show_all();
}

pub(super) fn install_media_permissions(webview: &Webview) -> Result<(), String> {
    let label = webview.label().to_owned();
    webview
        .with_webview(move |platform| {
            let view = platform.inner();
            let first = installed()
                .lock()
                .map(|mut views| views.insert(view.as_ptr() as usize))
                .unwrap_or(false);
            if !first {
                return;
            }
            // WebKitGTK ships camera, microphone and WebRTC switched off. Every
            // request now goes through the host's policy, so turn them on.
            if let Some(settings) = WebViewExt::settings(&view) {
                settings.set_enable_media_stream(true);
                settings.set_enable_webrtc(true);
            }
            view.connect_permission_request(move |view, request| {
                let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
                    return false;
                };
                let kind = match (media.is_for_video_device(), media.is_for_audio_device()) {
                    (true, true) => Some(MediaKind::CameraAndMicrophone),
                    (true, false) => Some(MediaKind::Camera),
                    (false, true) => Some(MediaKind::Microphone),
                    (false, false) => None,
                };
                let origin = page_origin(view);
                let request_info = MediaRequest {
                    webview: label.clone(),
                    top_origin: origin.clone(),
                    requester_origin: origin.clone(),
                    kind,
                    store: None,
                };
                match (media_verdict(&request_info), origin, kind) {
                    (Verdict::Deny, _, _) | (_, None, _) | (_, _, None) => request.deny(),
                    // The requesting frame is unknown, so an allowance is
                    // confirmed each time rather than extended to embeds.
                    (_, Some(origin), Some(kind)) => ask(view, request.clone(), &origin, kind),
                }
                true
            });
        })
        .map_err(|error| error.to_string())
}

pub(super) fn page_facts(
    webview: &Webview,
    reply: Reply<Result<PageFacts, String>>,
) -> Result<(), String> {
    webview
        .with_webview(move |platform| {
            let facts = platform
                .inner()
                .uri()
                .map(|url| url.to_string())
                .ok_or_else(|| "The page has no website address.".to_owned())
                .map(|url| PageFacts {
                    secure: url.starts_with("https:"),
                    url,
                    store: None,
                });
            let _ = reply.send(facts);
        })
        .map_err(|error| error.to_string())
}

pub(super) fn stop_capture(
    webview: &Webview,
    _store: Option<StoreScope>,
    camera: bool,
    microphone: bool,
    reply: Reply<()>,
) -> Result<(), String> {
    webview
        .with_webview(move |platform| {
            let view = platform.inner();
            if camera {
                view.set_camera_capture_state(MediaCaptureState::None);
            }
            if microphone {
                view.set_microphone_capture_state(MediaCaptureState::None);
            }
            let _ = reply.send(());
        })
        .map_err(|error| error.to_string())
}

pub(super) fn edit(webview: &Webview, command: super::EditCommand) -> Result<(), String> {
    // WEBKIT_EDITING_COMMAND_COPY / _CUT / _PASTE.
    let name = match command {
        super::EditCommand::Copy => "Copy",
        super::EditCommand::Cut => "Cut",
        super::EditCommand::Paste => "Paste",
    };
    webview
        .with_webview(move |platform| platform.inner().execute_editing_command(name))
        .map_err(|error| error.to_string())
}
