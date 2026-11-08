// SPDX-License-Identifier: MIT
//! Permission prompts: the app asks the person; no answer in a minute means no.
use super::{host::MistyExtensionHost, support::on_main_after};
use block2::DynBlock;
use objc2::{rc::Retained, Message};

use objc2_foundation::{NSDate, NSSet, NSString, NSURL, NSUUID};
use objc2_web_kit::{WKWebExtensionContext, WKWebExtensionMatchPattern};
use serde_json::{json, Map, Value};
use std::{ptr::NonNull, time::Duration};

impl MistyExtensionHost {
    /// Asks the app whether the person allows this; no answer in a minute means no.
    fn permission(
        &self,
        context: &WKWebExtensionContext,
        data: Value,
        complete: Box<dyn FnOnce(bool)>,
    ) {
        let request_id = NSUUID::new().UUIDString().to_string();
        self.state_mut()
            .pending
            .insert(request_id.clone(), complete);
        let mut event: Map<String, Value> = match data {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        event.insert("requestId".into(), request_id.clone().into());
        event.insert(
            "guid".into(),
            unsafe { context.uniqueIdentifier() }.to_string().into(),
        );
        self.event("permission-request", Value::Object(event));
        let this = self.retain();
        on_main_after(Duration::from_secs(60), move || {
            let pending = this.state_mut().pending.remove(&request_id);
            if let Some(pending) = pending {
                pending(false);
                this.event("permission-expired", json!({"requestId": request_id}));
            }
        });
    }

    pub(super) fn prompt_permissions(
        &self,
        permissions: &NSSet<NSString>,
        context: &WKWebExtensionContext,
        done: &DynBlock<dyn Fn(NonNull<NSSet<NSString>>, *mut NSDate)>,
    ) {
        let names: Vec<String> = permissions
            .allObjects()
            .iter()
            .map(|name| name.to_string())
            .collect();
        let (granted, done) = (permissions.retain(), done.copy());
        self.permission(
            context,
            json!({"permissions": names}),
            Box::new(move |allowed| {
                let answer: Retained<NSSet<NSString>> =
                    if allowed { granted } else { NSSet::new() };
                done.call((NonNull::from(&*answer), std::ptr::null_mut()));
            }),
        );
    }

    pub(super) fn prompt_patterns(
        &self,
        patterns: &NSSet<WKWebExtensionMatchPattern>,
        context: &WKWebExtensionContext,
        done: &DynBlock<dyn Fn(NonNull<NSSet<WKWebExtensionMatchPattern>>, *mut NSDate)>,
    ) {
        // SAFETY: reads each pattern's string.
        let hosts: Vec<String> = patterns
            .allObjects()
            .iter()
            .map(|pattern| unsafe { pattern.string() }.to_string())
            .collect();
        let (granted, done) = (patterns.retain(), done.copy());
        self.permission(
            context,
            json!({"hosts": hosts}),
            Box::new(move |allowed| {
                let answer: Retained<NSSet<WKWebExtensionMatchPattern>> =
                    if allowed { granted } else { NSSet::new() };
                done.call((NonNull::from(&*answer), std::ptr::null_mut()));
            }),
        );
    }

    pub(super) fn prompt_urls(
        &self,
        urls: &NSSet<NSURL>,
        context: &WKWebExtensionContext,
        done: &DynBlock<dyn Fn(NonNull<NSSet<NSURL>>, *mut NSDate)>,
    ) {
        let text = |value: Option<Retained<NSString>>| {
            value.map_or_else(|| "(null)".to_owned(), |value| value.to_string())
        };
        // SAFETY: reads each URL's scheme and host.
        let hosts: Vec<String> = urls
            .allObjects()
            .iter()
            .map(|url| format!("{}://{}/*", text(url.scheme()), text(url.host())))
            .collect();
        let (granted, done) = (urls.retain(), done.copy());
        self.permission(
            context,
            json!({"hosts": hosts}),
            Box::new(move |allowed| {
                let answer: Retained<NSSet<NSURL>> = if allowed { granted } else { NSSet::new() };
                done.call((NonNull::from(&*answer), std::ptr::null_mut()));
            }),
        );
    }
}
