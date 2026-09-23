//! Honor HTTP attachment responses even when WebKit can display their MIME type.
//! Wry 0.55 otherwise only selects Download for non-displayable responses.
#![allow(unexpected_cfgs)]
use objc::{msg_send, sel, sel_impl};
use objc2_foundation::{NSHTTPURLResponse, NSString};
use objc2_web_kit::{WKNavigationResponse, WKNavigationResponsePolicy};
use tauri::Webview;

const DELEGATE_CLASS: &str = "MistyAttachmentNavigationDelegate";

fn is_attachment(value: &str) -> bool {
    value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("attachment")
}

extern "C" fn response_policy(
    delegate: &objc::runtime::Object,
    _selector: objc::runtime::Sel,
    webview: *mut objc::runtime::Object,
    response: *mut objc::runtime::Object,
    handler: *mut objc::runtime::Object,
) {
    unsafe {
        let navigation = &*response.cast::<WKNavigationResponse>();
        let raw = navigation.response();
        let attachment = raw
            .downcast_ref::<NSHTTPURLResponse>()
            .and_then(|http| {
                http.valueForHTTPHeaderField(&NSString::from_str("Content-Disposition"))
            })
            .is_some_and(|value| is_attachment(&value.to_string()));
        if attachment {
            let block = &*handler.cast::<block2::Block<dyn Fn(WKNavigationResponsePolicy)>>();
            block.call((WKNavigationResponsePolicy::Download,));
            return;
        }
        // Preserve Wry's existing policy and native WKDownload delegate lifecycle.
        let superclass = objc::runtime::Class::get(DELEGATE_CLASS)
            .unwrap()
            .superclass()
            .unwrap();
        let _: () = msg_send![super(delegate, superclass), webView: webview
            decidePolicyForNavigationResponse: response decisionHandler: handler];
    }
}

pub(super) fn install(webview: &Webview) -> Result<(), String> {
    webview.with_webview(|native| unsafe {
        let view = native.inner() as *mut objc::runtime::Object;
        let delegate: *mut objc::runtime::Object = msg_send![view, navigationDelegate];
        if delegate.is_null() || (*delegate).class().name() == DELEGATE_CLASS { return; }
        let subclass = objc::runtime::Class::get(DELEGATE_CLASS).unwrap_or_else(|| {
            let mut declaration = objc::declare::ClassDecl::new(DELEGATE_CLASS, (*delegate).class())
                .expect("unique attachment delegate class");
            declaration.add_method(sel!(webView:decidePolicyForNavigationResponse:decisionHandler:),
                response_policy as extern "C" fn(&objc::runtime::Object, objc::runtime::Sel,
                    *mut objc::runtime::Object, *mut objc::runtime::Object, *mut objc::runtime::Object));
            declaration.register()
        });
        extern "C" {
            fn object_setClass(object: *mut objc::runtime::Object, class: *const objc::runtime::Class) -> *const objc::runtime::Class;
        }
        object_setClass(delegate, subclass);
        let _: () = msg_send![view, setNavigationDelegate: std::ptr::null_mut::<objc::runtime::Object>()];
        let _: () = msg_send![view, setNavigationDelegate: delegate];
    }).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_attachment;
    #[test]
    fn requires_attachment_disposition_not_a_filename_substring() {
        assert!(is_attachment("Attachment; filename=\"catalog.pdf\""));
        assert!(is_attachment(" attachment "));
        assert!(!is_attachment("inline; filename=\"attachment.pdf\""));
        assert!(!is_attachment("attachment-preview"));
        assert!(!is_attachment(""));
    }
}
