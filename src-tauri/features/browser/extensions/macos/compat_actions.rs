// SPDX-License-Identifier: MIT
//! What the compatibility layer does natively for an extension: language detection,
//! browsing data, tab moves, user scripts, idle state, downloads and identity redirects.
//! Requests reach these through `compat.rs`.
#![allow(clippy::disallowed_methods)] // The extension's own package folder, as the host always wrote it.
use super::{
    host::MistyExtensionHost,
    support::{string, text, unsigned},
    tabs::{MistyExtensionTab, MistyExtensionWindow},
};

use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
use objc2_core_foundation::CFDictionary;
use objc2_foundation::{NSCharacterSet, NSDictionary, NSNumber, NSString, NSURL};
use objc2_web_kit::WKWebExtensionContext;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::cmp::Reverse;

/// Where user scripts' code is stored inside an extension's own package.
const USER_SCRIPT_DIRECTORY: &str = "__misty_user_scripts__";
const IDENTITY_SUFFIX: &str = ".extensions.misty.invalid";

extern "C" {
    fn CGSessionCopyCurrentDictionary() -> *const CFDictionary;
    fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
}

impl MistyExtensionHost {
    pub(super) fn detect_language(&self, text: &Value) -> Value {
        let mut languages: Vec<(String, i64)> = Vec::new();
        let mut best = 0.0_f64;
        // SAFETY: NaturalLanguage's recognizer, driven by its documented selectors.
        unsafe {
            let recognizer: Retained<AnyObject> = msg_send![class!(NLLanguageRecognizer), new];
            if let Some(text) = text.as_str() {
                let limited: String = text.chars().take(20000).collect();
                let _: () = msg_send![&*recognizer, processString: &*string(&limited)];
            }
            let hypotheses: Retained<NSDictionary<NSString, NSNumber>> =
                msg_send![&*recognizer, languageHypothesesWithMaximum: 3usize];
            for language in hypotheses.allKeys().iter() {
                let probability = hypotheses
                    .objectForKey(&language)
                    .map_or(0.0, |n| n.doubleValue());
                best = best.max(probability);
                languages.push((language.to_string(), (probability * 100.0).round() as i64));
            }
        }
        languages.sort_by_key(|(_, percentage)| Reverse(*percentage));
        json!({
            "isReliable": best >= 0.8,
            "languages": languages.iter().map(|(language, percentage)| json!({"language": language, "percentage": percentage})).collect::<Vec<_>>(),
        })
    }

    /// Finds an extension-visible tab by its window's tab order and position, then asks
    /// Misty's workspace to move it. WebKit keeps its tab ids private. Returns an error message.
    pub(super) fn move_tab(
        &self,
        request: &Value,
        context: &WKWebExtensionContext,
    ) -> Option<String> {
        if !request.is_object() || !request.get("urls").is_some_and(Value::is_array) {
            return Some("Invalid tab move.".into());
        }
        let Some(found) = self.locate_tab(request, context) else {
            return Some("Misty could not identify that tab.".into());
        };
        self.event(
            "move-tab",
            json!({"tabId": found.identifier(), "index": unsigned(request.get("to").unwrap_or(&Value::Null))}),
        );
        None
    }

    /// The one tab at `from` in the only window whose tabs show these addresses, as this
    /// extension sees them. None when no window, or more than one, matches.
    pub(super) fn locate_tab(
        &self,
        request: &Value,
        context: &WKWebExtensionContext,
    ) -> Option<Retained<MistyExtensionTab>> {
        let urls = request.get("urls").and_then(Value::as_array)?;
        let from = unsigned(request.get("from").unwrap_or(&Value::Null));
        let mut windows: Vec<Retained<MistyExtensionWindow>> = Vec::new();
        for tab in self.all_tabs() {
            if let Some(window) = tab.window() {
                if !windows.iter().any(|seen| std::ptr::eq(&**seen, &*window)) {
                    windows.push(window);
                }
            }
        }
        let (mut found, mut candidates) = (None, 0);
        for window in windows {
            let tabs = window.tabs_for(context);
            if tabs.len() != urls.len() || from >= tabs.len() {
                continue;
            }
            let same = tabs.iter().zip(urls).all(|(tab, expected)| {
                let expected = expected.as_str().unwrap_or_default();
                let actual = tab
                    .current_url()
                    .map(|url| super::tabs::url_text(&url))
                    .unwrap_or_default();
                expected.is_empty() || expected == actual
            });
            if same {
                found = Some(tabs[from].clone());
                candidates += 1;
            }
        }
        if candidates == 1 {
            found
        } else {
            None
        }
    }

    /// Stores a user script's code as a file in the extension's own package, named by its
    /// SHA-256, and returns its package path. WebKit registers scripts only from files.
    /// Bounded: 4 MiB a script and 2,000 scripts an extension.
    pub(super) fn write_user_script(&self, code: &Value, identifier: &str) -> Option<String> {
        let data = code.as_str()?.as_bytes();
        let descriptor = self.descriptor(identifier)?;
        let root = text(&descriptor, "runtimePath")?;
        if data.len() > 4 * 1024 * 1024 {
            return None;
        }
        let name = format!(
            "{}.js",
            Sha256::digest(data)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        let directory = std::path::Path::new(root).join(USER_SCRIPT_DIRECTORY);
        let file = directory.join(&name);
        if !file.exists() {
            std::fs::create_dir_all(&directory).ok()?;
            if std::fs::read_dir(&directory).ok()?.count() >= 2000 {
                return None;
            }
            // Written whole or not at all.
            let staging = directory.join(format!(".{name}.{}", std::process::id()));
            std::fs::write(&staging, data).ok()?;
            std::fs::rename(&staging, &file).ok()?;
        }
        Some(format!("{USER_SCRIPT_DIRECTORY}/{name}"))
    }

    pub(super) fn idle_state(&self, threshold: &Value) -> String {
        let seconds = threshold.as_f64().map_or(60.0, |value| value.max(15.0));
        // SAFETY: Core Graphics session queries; the returned dictionary is owned (Copy rule),
        // and toll-free bridged to NSDictionary.
        unsafe {
            let session = CGSessionCopyCurrentDictionary();
            if !session.is_null() {
                let session: Retained<NSDictionary<NSString, AnyObject>> =
                    Retained::from_raw(session as *mut NSDictionary<NSString, AnyObject>)
                        .expect("non-null");
                let locked = session
                    .objectForKey(&string("CGSSessionScreenIsLocked"))
                    .and_then(|value| value.downcast::<NSNumber>().ok())
                    .is_some_and(|value| value.boolValue());
                if locked {
                    return "locked".into();
                }
            }
            // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = ~0.
            let idle = CGEventSourceSecondsSinceLastEventType(0, u32::MAX);
            if idle >= seconds { "idle" } else { "active" }.into()
        }
    }

    /// The extension page that receives an OAuth redirect to `url`, if it is one.
    pub(super) fn identity_redirect(&self, url: &NSURL) -> Option<Retained<NSURL>> {
        let (name, scheme) = {
            (
                url.host().map(|h| h.to_string().to_lowercase())?,
                url.scheme().map(|s| s.to_string().to_lowercase()),
            )
        };
        if scheme.as_deref() != Some("https") || !name.ends_with(IDENTITY_SUFFIX) {
            return None;
        }
        let origin = &name[..name.len() - IDENTITY_SUFFIX.len()];
        let contexts: Vec<Retained<WKWebExtensionContext>> =
            self.state().contexts.values().cloned().collect();
        for context in contexts {
            // SAFETY: reads the context's base address.
            let base = unsafe { context.baseURL() };
            let host = base.host().map(|h| h.to_string().to_lowercase());
            if host.as_deref() != Some(origin) {
                continue;
            }
            let full = url.absoluteString()?;
            let fragment = full.stringByAddingPercentEncodingWithAllowedCharacters(
                &NSCharacterSet::alphanumericCharacterSet(),
            )?;
            let page = string(&format!("__misty_compat__/identity.html#{fragment}"));
            return NSURL::URLWithString_relativeToURL(&page, Some(&base))
                .and_then(|url| url.absoluteURL());
        }
        None
    }
}
