// SPDX-License-Identifier: MIT
//! Checking a package before any Space installs it, and erasing a removed Space's extension data.
use super::support::{once, string, text, Reply};
use block2::RcBlock;
use objc2::{MainThreadMarker, MainThreadOnly as _};
use objc2_foundation::{NSProcessInfo, NSURL, NSUUID};
use objc2_web_kit::{
    WKWebExtension, WKWebExtensionController, WKWebExtensionControllerConfiguration,
    WKWebExtensionError,
};
use serde_json::{json, Value};

/// Checks a downloaded package before any Space installs it; needs no host.
pub(super) fn validate_package(mtm: MainThreadMarker, request: &Value, reply: Reply) {
    let root = NSURL::fileURLWithPath_isDirectory(
        &string(text(request, "runtimePath").unwrap_or_default()),
        true,
    );
    let reply = once(reply);
    let completion = RcBlock::new(
        move |extension: *mut WKWebExtension, failure: *mut objc2_foundation::NSError| {
            // SAFETY: WebKit passes live objects or null.
            let (extension, failure) = unsafe { (extension.as_ref(), failure.as_ref()) };
            let Some(extension) = extension.filter(|_| failure.is_none()) else {
                let message = failure
                    .map(|failure| failure.localizedDescription().to_string())
                    .unwrap_or_else(|| "Invalid extension manifest.".into());
                return reply(
                    json!({"error": if message.is_empty() { "Invalid extension manifest.".to_owned() } else { message }}),
                );
            };
            let mut errors = Vec::new();
            let mut blocked = false;
            // SAFETY: reads the extension's load findings and requested hosts.
            let hosts: Vec<String> = unsafe {
                for issue in extension.errors().iter() {
                    errors.push(issue.localizedDescription().to_string());
                    let code = WKWebExtensionError(issue.code());
                    if [
                        WKWebExtensionError::InvalidManifest,
                        WKWebExtensionError::UnsupportedManifestVersion,
                        WKWebExtensionError::ResourceNotFound,
                        WKWebExtensionError::InvalidArchive,
                    ]
                    .contains(&code)
                    {
                        blocked = true;
                    }
                }
                extension
                    .allRequestedMatchPatterns()
                    .allObjects()
                    .iter()
                    .map(|pattern| pattern.string().to_string())
                    .collect()
            };
            reply(json!({
                "findings": errors, "blocked": blocked,
                "platform": NSProcessInfo::processInfo().operatingSystemVersionString().to_string(),
                "hosts": hosts,
            }));
        },
    );
    // SAFETY: the handler is retained by WebKit until called.
    unsafe {
        WKWebExtension::extensionWithResourceBaseURL_completionHandler(&root, &completion, mtm)
    };
}

/// Erases what a removed Space's controller kept: every extension's storage.
pub(super) fn remove_controller_data(
    mtm: MainThreadMarker,
    identifier: Option<&str>,
    reply: Reply,
) {
    let Some(uuid) = identifier.and_then(|id| NSUUID::from_string(&string(id))) else {
        return reply(json!({"error": "Invalid extension controller."}));
    };
    // SAFETY: a throwaway controller over the removed Space's identifier.
    unsafe {
        let configuration =
            WKWebExtensionControllerConfiguration::configurationWithIdentifier(&uuid, mtm);
        let controller = WKWebExtensionController::initWithConfiguration(
            WKWebExtensionController::alloc(mtm),
            &configuration,
        );
        let types = WKWebExtensionController::allExtensionDataTypes(mtm);
        let (reply, removing, again) = (once(reply), controller.clone(), types.clone());
        let fetched = RcBlock::new(
            move |records: std::ptr::NonNull<
                objc2_foundation::NSArray<objc2_web_kit::WKWebExtensionDataRecord>,
            >| {
                // The controller stays alive until WebKit has removed its records.
                let keep = removing.clone();
                let reply = reply.clone();
                let done = RcBlock::new(move || {
                    let _ = &keep;
                    reply(json!({}));
                });
                removing.removeDataOfTypes_fromDataRecords_completionHandler(
                    &again,
                    records.as_ref(),
                    &done,
                );
            },
        );
        controller.fetchDataRecordsOfTypes_completionHandler(&types, &fetched);
    }
}
