// SPDX-License-Identifier: MIT
//! The extension operations Misty's app asks a Space's host for.
use super::{
    host::MistyExtensionHost,
    support::{once, string, text, truthy, Reply},
    tabs::url_text,
};

use block2::RcBlock;
use objc2::{rc::Retained, DefinedClass, MainThreadOnly as _};

use objc2_foundation::{NSProcessInfo, NSUUID};
use objc2_web_kit::{WKWebExtensionController, WKWebExtensionDataRecord, WKWebsiteDataStore};
use serde_json::{json, Value};

impl MistyExtensionHost {
    pub(super) fn request(&self, request: &Value, reply: Reply) {
        let operation = text(request, "operation").unwrap_or_default().to_owned();
        let identifier = text(request, "id").unwrap_or_default().to_owned();
        if operation == "configure" {
            self.configure(request, reply);
            return;
        }
        let account = self.account();
        if account.is_none() || text(request, "account") != account.as_deref() {
            reply(json!({"error": "The extension account changed."}));
            return;
        }
        let Some(reply) = self.compat_request(request, reply) else {
            return;
        };
        match operation.as_str() {
            "diagnostics" => return reply(self.diagnostics()),
            "layout" => {
                self.layout(request);
                return reply(json!({}));
            }
            "permission-response" => {
                let pending =
                    text(request, "requestId").and_then(|id| self.state_mut().pending.remove(id));
                if let Some(complete) = pending {
                    complete(truthy(request.get("allowed").unwrap_or(&Value::Null)));
                }
                return reply(json!({}));
            }
            "pending-navigation" => {
                let pending = text(request, "tabId")
                    .and_then(|id| self.tab(id))
                    .is_some_and(|tab| tab.ivars().pending_navigation.borrow().is_some());
                return reply(json!({"pending": pending}));
            }
            "tab-created" => {
                self.tab_created(request);
                return reply(json!({}));
            }
            "sync-restored" => {
                let known = self.context(&identifier).is_some()
                    && !self.state().restored.contains(&identifier);
                if known {
                    self.state_mut().restored.insert(identifier);
                    self.event("actions-changed", json!({}));
                }
                return reply(json!({}));
            }
            "load" => return self.load(request, reply),
            "unload" | "remove" => {
                return self.unload_request(request, &operation, &identifier, reply)
            }
            "actions" => return reply(self.actions(request)),
            "context-menu" => {
                self.context_menu(request);
                return reply(json!({}));
            }
            _ => {}
        }
        let Some(context) = self.context(&identifier) else {
            return reply(json!({"error": "This extension is not running."}));
        };
        if (operation == "invoke" || operation == "options")
            && !self.state().restored.contains(&identifier)
        {
            return reply(
                json!({"error": "Extension settings are still restoring. Unlock account sync to continue."}),
            );
        }
        match operation.as_str() {
            "invoke" => reply(self.invoke(request, &context)),
            "options" => {
                // SAFETY: reads the manifest's options page address.
                match unsafe { context.optionsPageURL() } {
                    None => reply(json!({"error": "This extension has no options page."})),
                    Some(url) => {
                        self.event("open-tab", json!({"url": url_text(&url), "private": false}));
                        reply(json!({}));
                    }
                }
            }
            "popup-evaluate" => self.popup_evaluate(request, &context, &identifier, reply),
            "sync-apply" => self.apply_sync(
                &identifier,
                request.get("changes").cloned().unwrap_or(json!({})),
                reply,
            ),
            _ => reply(json!({"error": "Unknown extension operation."})),
        }
    }

    fn configure(&self, request: &Value, reply: Reply) {
        let account = text(request, "account").unwrap_or_default().to_owned();
        if self.account().as_deref() != Some(account.as_str()) {
            self.shutdown();
            let mut state = self.state_mut();
            state.account = Some(account);
            state.controller_identifier =
                text(request, "controllerId").unwrap_or_default().to_owned();
        }
        // The controller is made once, over the store the Space has now. A later
        // store change (a new sign-in generation) applies when the Space reopens.
        if self.controller().is_none() {
            let store = text(request, "store").and_then(|id| NSUUID::from_string(&string(id)));
            let Some(store) = store else {
                return reply(json!({"error": "This Space has no website data store."}));
            };
            // SAFETY: looks up a named store on the main thread.
            let store = unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&store, self.mtm()) };
            self.start_with_store(store);
        }
        reply(json!({"supported": true}));
    }

    fn diagnostics(&self) -> Value {
        let (runtimes, bridges) = {
            let state = self.state();
            (state.contexts.len(), state.bridges.len())
        };
        json!({
            "runtimeCount": runtimes, "bridgeViewCount": bridges,
            "platform": NSProcessInfo::processInfo().operatingSystemVersionString().to_string(),
            "minimumOS": "15.4", "manifestVersions": [2, 3],
            "compatibility": "Version-specific testing required",
            "acquisition": ["firefox-addons", "chrome-web-store"],
            "knownUnavailable": ["debugger", "proxy"],
            "limited": ["webRequestBlocking", "identity", "management", "tabHide", "contextualIdentities", "privacy", "sidePanel", "offscreen", "tabGroups", "declarativeContent", "contentSettings", "fontSettings", "power", "userScripts", "tabCapture", "desktopCapture"],
            "compatibilityLayer": ["notifications", "downloads", "history", "topSites", "search", "sessions", "browsingData", "find", "idle", "tts", "theme", "sidePanel", "offscreen", "bookmarks", "tabGroups", "declarativeContent", "contentSettings", "fontSettings", "power", "userScripts", "tabCapture", "desktopCapture"],
            "hostLimitations": ["moving existing tabs into new windows", "pinned and reader-mode tabs"],
        })
    }

    /// The app says the tab it asked for now exists in a view.
    fn tab_created(&self, request: &Value) {
        let (request_id, tab_id) = (
            text(request, "requestId").unwrap_or_default(),
            text(request, "tabId").unwrap_or_default(),
        );
        if !self.state().open_requests.contains_key(request_id) {
            return;
        }
        match self.tab(tab_id) {
            Some(tab) => {
                let done = self.state_mut().open_requests.remove(request_id);
                if let Some(done) = done {
                    done(Some(tab), None);
                }
            }
            None => {
                self.state_mut()
                    .opening_tabs
                    .insert(tab_id.to_owned(), request_id.to_owned());
            }
        }
    }

    fn unload_request(&self, request: &Value, operation: &str, identifier: &str, reply: Reply) {
        let context = self.context(identifier);
        self.unload(identifier);
        self.state_mut().descriptors.remove(identifier);
        let controller = self.controller();
        let (true, Some(controller)) = (operation == "remove", controller) else {
            return reply(json!({}));
        };
        // SAFETY: reads the context's identifier, then fetches and removes its stored data.
        unsafe {
            let guid = text(request, "guid")
                .map(str::to_owned)
                .or_else(|| context.map(|context| context.uniqueIdentifier().to_string()))
                .unwrap_or_default();
            let types = WKWebExtensionController::allExtensionDataTypes(self.mtm());
            let reply = once(reply);
            let removing = controller.clone();
            let types_again = types.clone();
            let fetched = RcBlock::new(
                move |records: std::ptr::NonNull<
                    objc2_foundation::NSArray<WKWebExtensionDataRecord>,
                >| {
                    let matching: Vec<Retained<WKWebExtensionDataRecord>> = records
                        .as_ref()
                        .iter()
                        .filter(|record| record.uniqueIdentifier().to_string() == guid)
                        .collect();
                    let matching = objc2_foundation::NSArray::from_retained_slice(&matching);
                    let reply = reply.clone();
                    let done = RcBlock::new(move || reply(json!({})));
                    removing.removeDataOfTypes_fromDataRecords_completionHandler(
                        &types_again,
                        &matching,
                        &done,
                    );
                },
            );
            controller.fetchDataRecordsOfTypes_completionHandler(&types, &fetched);
        }
    }
}
