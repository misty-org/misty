// SPDX-License-Identifier: MIT
//! Loading an extension into a Space's controller, and the sync bridge page that
//! mirrors its `storage.sync` to Misty's account.
use super::{
    grants::{grant, incognito_blocked, strings},
    host::MistyExtensionHost,
    support::{once, string, text, truthy, Reply},
};
use block2::RcBlock;
use objc2::{rc::Retained, MainThreadOnly as _, Message as _};
use objc2_foundation::{NSError, NSSet, NSURL, NSUUID};
use objc2_web_kit::{WKWebExtension, WKWebExtensionContext};
use serde_json::{json, Value};

/// The page every bridge loads, relative to the extension's base URL.
pub(super) const BRIDGE_PAGE: &str = "__misty_sync__/bridge.html";

impl MistyExtensionHost {
    /// The bridge page's address for an extension.
    pub(super) fn bridge_url(&self, identifier: &str) -> Option<Retained<NSURL>> {
        let base = self
            .context(identifier)
            .map(|context| unsafe { context.baseURL() })?;
        // SAFETY: a relative URL over the extension's base.
        NSURL::URLWithString_relativeToURL(&string(BRIDGE_PAGE), Some(&base))
    }

    pub(super) fn load(&self, descriptor: &Value, reply: Reply) {
        let identifier = text(descriptor, "id").unwrap_or_default().to_owned();
        let account = self.account();
        if self.controller().is_none() {
            reply(json!({"error": "This Space's extension host isn't ready."}));
            return;
        }
        let existing = self.context(&identifier);
        let previous = self.descriptor(&identifier);
        if let (Some(existing), Some(previous)) = (&existing, &previous) {
            let same_storage = strings(previous, "permissions")
                .iter()
                .any(|p| p == "storage")
                == strings(descriptor, "permissions")
                    .iter()
                    .any(|p| p == "storage");
            let same_path = matches!((previous.get("runtimePath"), descriptor.get("runtimePath")), (Some(a), Some(b)) if a == b);
            let same_guid = matches!((previous.get("guid"), descriptor.get("guid")), (Some(a), Some(b)) if a == b);
            if same_storage && same_path && same_guid {
                self.update_existing(existing, previous, descriptor, &identifier);
                reply(json!({"loaded": true}));
                return;
            }
        }
        let token = NSUUID::new().UUIDString().to_string();
        self.state_mut()
            .load_tokens
            .insert(identifier.clone(), token.clone());
        let runtime_path = text(descriptor, "runtimePath").unwrap_or_default();
        // SAFETY: a file URL for the extension's package folder.
        let root = NSURL::fileURLWithPath_isDirectory(&string(runtime_path), true);
        let this = self.retain();
        let descriptor = descriptor.clone();
        let reply = once(reply);
        let completion = RcBlock::new(
            move |extension: *mut WKWebExtension, failure: *mut NSError| {
                // SAFETY: WebKit passes live objects or null.
                let (extension, failure) =
                    unsafe { (Retained::retain(extension), failure.as_ref()) };
                let current = this.state().load_tokens.get(&identifier).cloned();
                if account != this.account() || current.as_deref() != Some(token.as_str()) {
                    reply(json!({"error": "The account changed."}));
                    return;
                }
                let Some(extension) = extension.filter(|_| failure.is_none()) else {
                    let message = failure
                        .map(|failure| failure.localizedDescription().to_string())
                        .unwrap_or_else(|| "The extension could not load.".into());
                    reply(json!({"error": message}));
                    return;
                };
                this.finish_load(&descriptor, &identifier, &extension, &*reply);
            },
        );
        // SAFETY: the handler is retained by WebKit until called.
        unsafe {
            WKWebExtension::extensionWithResourceBaseURL_completionHandler(
                &root,
                &completion,
                self.mtm(),
            )
        };
    }

    fn finish_load(
        &self,
        descriptor: &Value,
        identifier: &str,
        extension: &WKWebExtension,
        reply: &dyn Fn(Value),
    ) {
        self.unload(identifier);
        let Some(controller) = self.controller() else {
            reply(json!({"error": "The extension runtime rejected this package."}));
            return;
        };
        let mtm = self.mtm();
        // SAFETY: context construction and configuration on the main thread.
        let context = unsafe {
            let context = WKWebExtensionContext::initForExtension(
                WKWebExtensionContext::alloc(mtm),
                extension,
            );
            if let Some(guid) = text(descriptor, "guid") {
                context.setUniqueIdentifier(&string(guid));
            }
            let origin = text(descriptor, "origin").unwrap_or_default();
            if let Some(base) =
                NSURL::URLWithString(&string(&format!("webkit-extension://{origin}/")))
            {
                context.setBaseURL(&base);
            }
            context.setHasAccessToPrivateData(
                truthy(descriptor.get("privateAccess").unwrap_or(&Value::Null))
                    && !incognito_blocked(extension),
            );
            // MISTY_INSPECT_EXTENSIONS=1 shows each extension's background and popup in
            // Safari's Develop menu, to see why one fails. Off otherwise.
            context.setInspectable(std::env::var("MISTY_INSPECT_EXTENSIONS").as_deref() == Ok("1"));
            // identity, management and sidebarAction come from the compatibility layer.
            let unsupported = NSSet::from_retained_slice(&[
                string("browser.debugger"),
                string("browser.sidePanel"),
            ]);
            context.setUnsupportedAPIs(Some(&unsupported));
            context
        };
        grant(
            mtm,
            &context,
            &strings(descriptor, "permissions"),
            &strings(descriptor, "hosts"),
        );
        // SAFETY: loads a freshly made context.
        if let Err(failure) = unsafe { controller.loadExtensionContext_error(&context) } {
            let message = failure.localizedDescription().to_string();
            reply(
                json!({"error": if message.is_empty() { "The extension runtime rejected this package.".to_owned() } else { message }}),
            );
            return;
        }
        {
            let mut state = self.state_mut();
            state
                .contexts
                .insert(identifier.to_owned(), context.clone());
            state
                .descriptors
                .insert(identifier.to_owned(), descriptor.clone());
        }
        // WebKit wakes a background that isn't persistent only for events it saw the
        // extension register, and remembers those across launches. Starting it now lets
        // one that never ran here (or ran an older package) register its listeners.
        // SAFETY: background loading on a loaded context.
        if unsafe { extension.hasBackgroundContent() } {
            let this = self.retain();
            let id = identifier.to_owned();
            let completion = RcBlock::new(move |failure: *mut NSError| {
                // SAFETY: a live error or null.
                if let Some(failure) = unsafe { failure.as_ref() } {
                    this.event(
                        "background-error",
                        json!({"id": id, "detail": failure.localizedDescription().to_string()}),
                    );
                }
            });
            unsafe { context.loadBackgroundContentWithCompletionHandler(&completion) };
        }
        for tab in self.all_tabs() {
            self.register_open_tab(&tab);
        }
        self.start_compat(identifier, &context);
        // SAFETY: permission query on a loaded context.
        if unsafe { context.hasPermission(&string("storage")) } {
            self.start_bridge(identifier, &context);
        }
        if !self.state().bridges.contains_key(identifier) {
            self.state_mut().restored.insert(identifier.to_owned());
        }
        self.event("changed", json!({"id": identifier}));
        // SAFETY: reads the extension's load warnings.
        let errors: Vec<Value> = unsafe { extension.errors() }
            .iter()
            .map(|failure| Value::String(failure.localizedDescription().to_string()))
            .collect();
        reply(json!({"loaded": true, "errors": errors}));
    }
}
