// Copyright 2020-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#[cfg(target_os = "macos")]
use std::{cell::RefCell, ptr::null_mut, rc::Rc};

use block2::Block;
#[cfg(target_os = "macos")]
use objc2::DefinedClass;
use objc2::{define_class, msg_send, rc::Retained, runtime::NSObject, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSModalResponse, NSModalResponseOK, NSOpenPanel, NSWindowDelegate};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSURL};

#[cfg(target_os = "macos")]
use objc2_web_kit::WKOpenPanelParameters;
use objc2_web_kit::{
  WKFrameInfo, WKMediaCaptureType, WKPermissionDecision, WKSecurityOrigin, WKUIDelegate,
};

use crate::{NewWindowFeatures, NewWindowResponse, WryWebView};

#[cfg(target_os = "macos")]
struct NewWindow {
  #[allow(dead_code)]
  ns_window: Retained<objc2_app_kit::NSWindow>,
  #[allow(dead_code)]
  webview: Retained<objc2_web_kit::WKWebView>,
  #[allow(dead_code)]
  delegate: Retained<WryNSWindowDelegate>,
}

// SAFETY: we are not using the new window at all, just dropping it on another thread
#[cfg(target_os = "macos")]
unsafe impl Send for NewWindow {}

#[cfg(target_os = "macos")]
impl Drop for NewWindow {
  fn drop(&mut self) {
    self.webview.removeFromSuperview();
  }
}

#[cfg(target_os = "macos")]
struct WryNSWindowDelegateIvars {
  on_close: Box<dyn Fn()>,
}

#[cfg(target_os = "macos")]
define_class!(
  #[unsafe(super(NSObject))]
  #[thread_kind = MainThreadOnly]
  #[ivars = WryNSWindowDelegateIvars]
  struct WryNSWindowDelegate;

  unsafe impl NSObjectProtocol for WryNSWindowDelegate {}

  unsafe impl NSWindowDelegate for WryNSWindowDelegate {
    #[unsafe(method(windowWillClose:))]
    unsafe fn will_close(&self, _notification: &objc2_foundation::NSNotification) {
      let on_close = &self.ivars().on_close;
      on_close();
    }
  }
);

#[cfg(target_os = "macos")]
impl WryNSWindowDelegate {
  pub fn new(mtm: MainThreadMarker, on_close: Box<dyn Fn()>) -> Retained<Self> {
    let delegate = mtm
      .alloc::<WryNSWindowDelegate>()
      .set_ivars(WryNSWindowDelegateIvars { on_close });
    unsafe { msg_send![super(delegate), init] }
  }
}

pub struct WryWebViewUIDelegateIvars {
  #[cfg(target_os = "macos")]
  new_window_req_handler: Option<Box<dyn Fn(String, NewWindowFeatures) -> NewWindowResponse>>,
  #[cfg(target_os = "macos")]
  new_windows: Rc<RefCell<Vec<NewWindow>>>,
}

define_class!(
  #[unsafe(super(NSObject))]
  #[thread_kind = MainThreadOnly]
  #[ivars = WryWebViewUIDelegateIvars]
  pub struct WryWebViewUIDelegate;

  unsafe impl NSObjectProtocol for WryWebViewUIDelegate {}

  unsafe impl WKUIDelegate for WryWebViewUIDelegate {
    #[cfg(target_os = "macos")]
    #[unsafe(method(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:))]
    fn run_file_upload_panel(
      &self,
      _webview: &WryWebView,
      open_panel_params: &WKOpenPanelParameters,
      _frame: &WKFrameInfo,
      handler: &block2::Block<dyn Fn(*const NSArray<NSURL>)>,
    ) {
      unsafe {
        if let Some(mtm) = MainThreadMarker::new() {
          let open_panel = NSOpenPanel::openPanel(mtm);
          open_panel.setCanChooseFiles(true);
          let allow_multi = open_panel_params.allowsMultipleSelection();
          open_panel.setAllowsMultipleSelection(allow_multi);
          let allow_dir = open_panel_params.allowsDirectories();
          open_panel.setCanChooseDirectories(allow_dir);
          let ok: NSModalResponse = open_panel.runModal();
          if ok == NSModalResponseOK {
            let url = open_panel.URLs();
            (*handler).call((Retained::as_ptr(&url),));
          } else {
            (*handler).call((null_mut(),));
          }
        }
      }
    }

    #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
    fn request_media_capture_permission(
      &self,
      _webview: &WryWebView,
      origin: &WKSecurityOrigin,
      frame: &WKFrameInfo,
      _capture_type: WKMediaCaptureType,
      decision_handler: &Block<dyn Fn(WKPermissionDecision)>,
    ) {
      //https://developer.apple.com/documentation/webkit/wkpermissiondecision?language=objc
      // Misty patch: WebKit's own "Allow … to use your microphone?" panel never shows. The app's
      // own page (an origin the host named with `set_trusted_media_origins`, in its main frame) is
      // granted, so the microphone and camera are asked for once, by the system, and never again;
      // any other page, such as a website, is refused and never inherits that grant.
      let trusted = unsafe { frame.isMainFrame() } && media_origin_trusted(origin);
      let decision = if trusted {
        WKPermissionDecision::Grant
      } else {
        WKPermissionDecision::Deny
      };
      (*decision_handler).call((decision,));
    }

    #[cfg(target_os = "macos")]
    #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
    unsafe fn create_web_view_for_navigation_action(
      &self,
      webview: &WryWebView,
      configuration: &objc2_web_kit::WKWebViewConfiguration,
      action: &objc2_web_kit::WKNavigationAction,
      window_features: &objc2_web_kit::WKWindowFeatures,
    ) -> Option<Retained<objc2_web_kit::WKWebView>> {
      if let Some(new_window_req_handler) = &self.ivars().new_window_req_handler {
        let request = action.request();
        let url = request.URL().unwrap().absoluteString().unwrap();

        let current_window = webview.window().unwrap();
        let screen = current_window.screen().unwrap();
        let screen_frame = screen.frame();

        match new_window_req_handler(
          url.to_string(),
          NewWindowFeatures {
            size: if let (Some(width), Some(height)) =
              (window_features.width(), window_features.height())
            {
              Some(dpi::LogicalSize::new(
                width.doubleValue(),
                height.doubleValue(),
              ))
            } else {
              None
            },
            position: if let (Some(x), Some(y)) = (window_features.x(), window_features.y()) {
              Some(dpi::LogicalPosition::new(x.doubleValue(), y.doubleValue()))
            } else {
              None
            },
            opener: crate::NewWindowOpener {
              webview: webview.into(),
              target_configuration: configuration.into(),
            },
          },
        ) {
          NewWindowResponse::Allow => {
            let mtm = MainThreadMarker::new().unwrap();

            let defaults = current_window.frame();
            let size = objc2_foundation::NSSize::new(
              window_features
                .width()
                .map_or(defaults.size.width, |width| width.doubleValue()),
              window_features
                .height()
                .map_or(defaults.size.height, |height| height.doubleValue()),
            );
            let position = objc2_foundation::NSPoint::new(
              window_features
                .x()
                .map_or(defaults.origin.x, |x| x.doubleValue()),
              window_features.y().map_or(defaults.origin.y, |y| {
                screen_frame.size.height - y.doubleValue() - size.height
              }),
            );
            let rect = objc2_foundation::NSRect::new(position, size);

            let mut flags = objc2_app_kit::NSWindowStyleMask::Titled
              | objc2_app_kit::NSWindowStyleMask::Closable
              | objc2_app_kit::NSWindowStyleMask::Miniaturizable;
            let resizable = window_features
              .allowsResizing()
              .map_or(true, |resizable| resizable.boolValue());
            if resizable {
              flags |= objc2_app_kit::NSWindowStyleMask::Resizable;
            }

            let window = objc2_app_kit::NSWindow::initWithContentRect_styleMask_backing_defer(
              mtm.alloc::<objc2_app_kit::NSWindow>(),
              rect,
              flags,
              objc2_app_kit::NSBackingStoreType::Buffered,
              false,
            );

            // SAFETY: Disable auto-release when closing windows.
            // This is required when creating `NSWindow` outside a window
            // controller.
            window.setReleasedWhenClosed(false);

            let webview = objc2_web_kit::WKWebView::initWithFrame_configuration(
              mtm.alloc::<objc2_web_kit::WKWebView>(),
              window.frame(),
              configuration,
            );

            let new_windows = self.ivars().new_windows.clone();
            let window_id = Retained::as_ptr(&window) as usize;
            let delegate = WryNSWindowDelegate::new(
              mtm,
              Box::new(move || {
                new_windows
                  .borrow_mut()
                  .retain(|window| Retained::as_ptr(&window.ns_window) as usize != window_id);
              }),
            );
            window.setDelegate(Some(objc2::runtime::ProtocolObject::from_ref(&*delegate)));

            window.setContentView(Some(&webview));
            window.makeKeyAndOrderFront(None);

            self.ivars().new_windows.borrow_mut().push(NewWindow {
              ns_window: window,
              webview: webview.clone(),
              delegate,
            });

            Some(webview)
          }
          NewWindowResponse::Create { webview } => Some(webview),
          NewWindowResponse::Deny => None,
        }
      } else {
        None
      }
    }
  }

  // Not part of WKUIDelegate's public protocol, so it sits with the class's own methods: objc2
  // checks every method in a protocol block against the protocol and refuses one it doesn't list.
  impl WryWebViewUIDelegate {
    // Misty patch: a page sharing its screen (getDisplayMedia) goes straight to the system's own
    // screen picker on the app's own page, with no WebKit panel before it; any other page is
    // refused. WebKit's private delegate; its decision is 0 deny, 1 screen, 2 window.
    #[cfg(target_os = "macos")]
    #[unsafe(method(_webView:requestDisplayCapturePermissionForOrigin:initiatedByFrame:withSystemAudio:decisionHandler:))]
    fn request_display_capture_permission(
      &self,
      _webview: &WryWebView,
      origin: &WKSecurityOrigin,
      frame: &WKFrameInfo,
      _system_audio: objc2::runtime::Bool,
      decision_handler: &Block<dyn Fn(isize)>,
    ) {
      let trusted = unsafe { frame.isMainFrame() } && media_origin_trusted(origin);
      (*decision_handler).call((if trusted { 1 } else { 0 },));
    }
  }
);

impl WryWebViewUIDelegate {
  pub fn new(
    mtm: MainThreadMarker,
    new_window_req_handler: Option<Box<dyn Fn(String, NewWindowFeatures) -> NewWindowResponse>>,
  ) -> Retained<Self> {
    #[cfg(target_os = "ios")]
    let _new_window_req_handler = new_window_req_handler;

    let delegate = mtm
      .alloc::<WryWebViewUIDelegate>()
      .set_ivars(WryWebViewUIDelegateIvars {
        #[cfg(target_os = "macos")]
        new_window_req_handler,
        #[cfg(target_os = "macos")]
        new_windows: Rc::new(RefCell::new(vec![])),
      });
    unsafe { msg_send![super(delegate), init] }
  }
}

/// The origins of the host app's own pages (`tauri://localhost`, a development server's
/// `http://127.0.0.1:5173`), which may use the microphone and camera without WebKit asking.
static TRUSTED_MEDIA_ORIGINS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

/// Names the host app's own origins, once at startup: those pages get the microphone and camera
/// with no WebKit panel (the system still asks the person once), and every other page is refused.
pub fn set_trusted_media_origins(origins: Vec<String>) {
  let _ = TRUSTED_MEDIA_ORIGINS.set(
    origins
      .into_iter()
      .map(|origin| origin.trim_end_matches('/').to_ascii_lowercase())
      .collect(),
  );
}

fn media_origin_trusted(origin: &WKSecurityOrigin) -> bool {
  let Some(trusted) = TRUSTED_MEDIA_ORIGINS.get() else {
    return false;
  };
  let (protocol, host, port) = unsafe { (origin.protocol(), origin.host(), origin.port()) };
  let mut name = format!("{protocol}://{host}").to_ascii_lowercase();
  if port != 0 {
    name.push_str(&format!(":{port}"));
  }
  trusted.iter().any(|item| *item == name)
}
