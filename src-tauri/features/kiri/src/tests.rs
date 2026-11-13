use super::*;
use capabilities::ready;
use serde_json::json;
use std::{
    future::Future,
    pin::pin,
    task::{Context, Poll, Waker},
};

const VIEW: &str = "misty-browser-1";

struct NoHost;

impl Host for NoHost {}

/// A powerful-feature stand-in: secure context required.
struct Powerful;

impl Capability for Powerful {
    fn name(&self) -> &'static str {
        "powerful"
    }

    fn call(&self, call: Call) -> Reply {
        ready(Ok(json!({ "origin": call.caller.origin })))
    }
}

fn kiri() -> Kiri {
    Kiri::new("misty-browser-", NoHost).with(Powerful)
}

/// Every capability here resolves without suspending.
fn run<F: Future>(future: F) -> F::Output {
    match pin!(future).poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("capability suspended"),
    }
}

fn dispatch(
    kiri: &Kiri,
    view: &str,
    url: &str,
    request: serde_json::Value,
) -> Result<Value, KiriError> {
    let request: Request = serde_json::from_value(request).unwrap();
    run(kiri.dispatch(view, &Url::parse(url).unwrap(), request))
}

#[test]
fn unknown_capabilities_are_not_supported() {
    let reply = dispatch(
        &kiri(),
        VIEW,
        "https://a.example/",
        json!({ "v": 1, "cap": "bluetooth", "method": "request-device" }),
    );
    assert_eq!(reply.unwrap_err().name, "NotSupportedError");
}

#[test]
fn only_prefixed_views_are_served() {
    let kiri = kiri();
    for view in ["main", "misty-agent-1", "misty-browse"] {
        let reply = dispatch(
            &kiri,
            view,
            "https://a.example/",
            json!({ "v": 1, "cap": "powerful", "method": "use" }),
        );
        assert_eq!(reply.unwrap_err().name, "SecurityError", "{view}");
    }
}

#[test]
fn powerful_capabilities_need_a_secure_context() {
    let kiri = kiri();
    let call = json!({ "v": 1, "cap": "powerful", "method": "use" });
    assert_eq!(
        dispatch(&kiri, VIEW, "http://plain.example/", call.clone())
            .unwrap_err()
            .name,
        "SecurityError"
    );
    assert_eq!(
        dispatch(&kiri, VIEW, "https://secure.example/page", call),
        Ok(json!({ "origin": "https://secure.example" }))
    );
}

#[test]
fn page_script_installs_the_transport() {
    let script = page_script();
    assert!(!script.contains("__KIRI_CAPABILITIES__"));
    assert!(script.contains("plugin:kiri|call"));
    // The transport never navigates to report; navigations can cancel page loads.
    assert!(!script.contains("location.href"));
}
