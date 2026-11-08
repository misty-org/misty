// SPDX-License-Identifier: MIT
//! One extension host per Space: its own `WKWebExtensionController` over the Space's
//! website data store, the extensions loaded in it, and the tabs and windows it shows them.

use block2::DynBlock;
use objc2::{
    define_class,
    rc::Retained,
    runtime::{AnyObject, NSObject, ProtocolObject},
    MainThreadOnly,
};

use objc2_foundation::{
    NSArray, NSDate, NSError, NSNotification, NSObjectProtocol, NSSet, NSString, NSURL,
};
use objc2_web_kit::{
    WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKScriptMessage,
    WKScriptMessageHandler, WKUserContentController, WKWebExtensionAction, WKWebExtensionContext,
    WKWebExtensionController, WKWebExtensionControllerDelegate, WKWebExtensionMatchPattern,
    WKWebExtensionMessagePort, WKWebExtensionTab, WKWebExtensionTabConfiguration,
    WKWebExtensionWindow, WKWebExtensionWindowConfiguration, WKWebView,
};
use serde_json::{Map, Value};
use std::ptr::NonNull;

pub(super) use super::state::{CompatReply, HostIvars, OpenDone};

type DecisionHandler = DynBlock<dyn Fn(WKNavigationActionPolicy)>;
type Completion = DynBlock<dyn Fn(*mut NSError)>;

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = HostIvars]
    pub(super) struct MistyExtensionHost;

    unsafe impl NSObjectProtocol for MistyExtensionHost {}

    unsafe impl WKScriptMessageHandler for MistyExtensionHost {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn did_receive(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
            self.bridge_message(message);
        }
    }

    unsafe impl WKNavigationDelegate for MistyExtensionHost {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy(
            &self,
            view: &WKWebView,
            action: &WKNavigationAction,
            done: &DecisionHandler,
        ) {
            let allowed = self.allows_navigation(view, action);
            done.call((if allowed {
                WKNavigationActionPolicy::Allow
            } else {
                WKNavigationActionPolicy::Cancel
            },));
        }
    }

    unsafe impl WKWebExtensionControllerDelegate for MistyExtensionHost {
        #[unsafe(method_id(webExtensionController:openWindowsForExtensionContext:))]
        fn open_windows_for(
            &self,
            _controller: &WKWebExtensionController,
            context: &WKWebExtensionContext,
        ) -> Retained<NSArray<ProtocolObject<dyn WKWebExtensionWindow>>> {
            self.open_windows(context)
        }

        #[unsafe(method_id(webExtensionController:focusedWindowForExtensionContext:))]
        fn focused_window_for(
            &self,
            _controller: &WKWebExtensionController,
            context: &WKWebExtensionContext,
        ) -> Option<Retained<ProtocolObject<dyn WKWebExtensionWindow>>> {
            self.focused_window(context)
        }

        #[unsafe(method(webExtensionController:didUpdateAction:forExtensionContext:))]
        fn did_update_action(
            &self,
            _controller: &WKWebExtensionController,
            _action: &WKWebExtensionAction,
            _context: &WKWebExtensionContext,
        ) {
            self.event("actions-changed", Value::Object(Map::new()));
        }

        #[unsafe(method(webExtensionController:presentPopupForAction:forExtensionContext:completionHandler:))]
        fn present_popup_for(
            &self,
            _controller: &WKWebExtensionController,
            action: &WKWebExtensionAction,
            _context: &WKWebExtensionContext,
            done: &Completion,
        ) {
            self.present_popup(action, done);
        }

        #[unsafe(method(webExtensionController:openOptionsPageForExtensionContext:completionHandler:))]
        fn open_options_for(
            &self,
            _controller: &WKWebExtensionController,
            context: &WKWebExtensionContext,
            done: &Completion,
        ) {
            self.open_options_page(context, done);
        }

        #[unsafe(method(webExtensionController:openNewTabUsingConfiguration:forExtensionContext:completionHandler:))]
        fn open_new_tab_for(
            &self,
            _controller: &WKWebExtensionController,
            configuration: &WKWebExtensionTabConfiguration,
            context: &WKWebExtensionContext,
            done: &DynBlock<dyn Fn(*mut ProtocolObject<dyn WKWebExtensionTab>, *mut NSError)>,
        ) {
            self.open_new_tab(configuration, context, done);
        }

        #[unsafe(method(webExtensionController:openNewWindowUsingConfiguration:forExtensionContext:completionHandler:))]
        fn open_new_window_for(
            &self,
            _controller: &WKWebExtensionController,
            configuration: &WKWebExtensionWindowConfiguration,
            context: &WKWebExtensionContext,
            done: &DynBlock<dyn Fn(*mut ProtocolObject<dyn WKWebExtensionWindow>, *mut NSError)>,
        ) {
            self.open_new_window(configuration, context, done);
        }

        #[unsafe(method(webExtensionController:promptForPermissions:inTab:forExtensionContext:completionHandler:))]
        fn prompt_for_permissions(
            &self,
            _controller: &WKWebExtensionController,
            permissions: &NSSet<NSString>,
            _tab: Option<&ProtocolObject<dyn WKWebExtensionTab>>,
            context: &WKWebExtensionContext,
            done: &DynBlock<dyn Fn(NonNull<NSSet<NSString>>, *mut NSDate)>,
        ) {
            self.prompt_permissions(permissions, context, done);
        }

        #[unsafe(method(webExtensionController:promptForPermissionMatchPatterns:inTab:forExtensionContext:completionHandler:))]
        fn prompt_for_patterns(
            &self,
            _controller: &WKWebExtensionController,
            patterns: &NSSet<WKWebExtensionMatchPattern>,
            _tab: Option<&ProtocolObject<dyn WKWebExtensionTab>>,
            context: &WKWebExtensionContext,
            done: &DynBlock<dyn Fn(NonNull<NSSet<WKWebExtensionMatchPattern>>, *mut NSDate)>,
        ) {
            self.prompt_patterns(patterns, context, done);
        }

        #[unsafe(method(webExtensionController:promptForPermissionToAccessURLs:inTab:forExtensionContext:completionHandler:))]
        fn prompt_for_urls(
            &self,
            _controller: &WKWebExtensionController,
            urls: &NSSet<NSURL>,
            _tab: Option<&ProtocolObject<dyn WKWebExtensionTab>>,
            context: &WKWebExtensionContext,
            done: &DynBlock<dyn Fn(NonNull<NSSet<NSURL>>, *mut NSDate)>,
        ) {
            self.prompt_urls(urls, context, done);
        }

        #[unsafe(method(webExtensionController:sendMessage:toApplicationWithIdentifier:forExtensionContext:replyHandler:))]
        fn send_message_to_application(
            &self,
            _controller: &WKWebExtensionController,
            message: &AnyObject,
            application: Option<&NSString>,
            context: &WKWebExtensionContext,
            reply: &DynBlock<dyn Fn(*mut AnyObject, *mut NSError)>,
        ) {
            self.send_native_message(message, application, context, reply);
        }

        #[unsafe(method(webExtensionController:connectUsingMessagePort:forExtensionContext:completionHandler:))]
        fn connect_message_port(
            &self,
            _controller: &WKWebExtensionController,
            port: &WKWebExtensionMessagePort,
            context: &WKWebExtensionContext,
            done: &Completion,
        ) {
            self.connect_native_port(port, context, done);
        }
    }

    impl MistyExtensionHost {
        #[unsafe(method(permissionsRemoved:))]
        fn permissions_removed_selector(&self, notification: &NSNotification) {
            self.permissions_removed(notification);
        }

        #[unsafe(method(runtimeErrors:))]
        fn runtime_errors_selector(&self, notification: &NSNotification) {
            self.runtime_errors(notification);
        }

        #[unsafe(method(popupClosed:))]
        fn popup_closed_selector(&self, _notification: &NSNotification) {
            self.popup_closed();
        }

        #[unsafe(method(windowFocused:))]
        fn window_focused_selector(&self, notification: &NSNotification) {
            self.window_focused(notification);
        }

        #[unsafe(method(popupWindowClosing:))]
        fn popup_window_closing_selector(&self, notification: &NSNotification) {
            self.popup_window_closing(notification);
        }
    }
);
