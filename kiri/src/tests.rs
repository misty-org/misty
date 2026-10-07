use super::*;
use capabilities::ready;
use serde_json::json;
use std::{
    future::Future,
    pin::pin,
    sync::Mutex,
    task::{Context, Poll, Waker},
};

const VIEW: &str = "misty-browser-1";

#[derive(Default)]
struct Recorder {
    signals: Mutex<Vec<(Caller, Signal)>>,
    allowed: Vec<&'static str>,
}

impl Host for Arc<Recorder> {
    fn allows(&self, caller: &Caller, _capability: &str) -> bool {
        self.allowed.contains(&caller.origin.as_str())
    }

    fn signal(&self, caller: &Caller, signal: Signal) {
        self.signals.lock().unwrap().push((caller.clone(), signal));
    }
}

/// A powerful-feature stand-in: secure context and permission required.
struct Powerful;

impl Capability for Powerful {
    fn name(&self) -> &'static str {
        "powerful"
    }

    fn needs_permission(&self) -> bool {
        true
    }

    fn call(&self, call: Call) -> Reply {
        ready(Ok(json!({ "origin": call.caller.origin })))
    }
}

fn kiri(allowed: Vec<&'static str>) -> (Kiri, Arc<Recorder>) {
    let recorder = Arc::new(Recorder { allowed, ..Recorder::default() });
    (Kiri::new("misty-browser-", recorder.clone()).with(Powerful), recorder)
}

/// Every capability here resolves without suspending.
fn run<F: Future>(future: F) -> F::Output {
    match pin!(future).poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("capability suspended"),
    }
}

fn dispatch(kiri: &Kiri, view: &str, url: &str, request: serde_json::Value) -> Result<Value, KiriError> {
    let request: Request = serde_json::from_value(request).unwrap();
    run(kiri.dispatch(view, &Url::parse(url).unwrap(), request))
}

#[test]
fn media_state_reaches_the_host_as_the_engine_reported_caller() {
    let (kiri, recorder) = kiri(vec![]);
    let reply = dispatch(&kiri, VIEW, "http://radio.example/live", json!({ "v": 1, "cap": "media", "method": "state", "args": { "audible": true } }));
    assert_eq!(reply, Ok(Value::Null));
    let signals = recorder.signals.lock().unwrap();
    let (caller, signal) = &signals[0];
    assert_eq!(caller.webview, VIEW);
    assert_eq!(caller.origin, "http://radio.example");
    assert_eq!(signal, &Signal::MediaAudible(true));
}

#[test]
fn media_rejects_malformed_state_and_unknown_methods() {
    let (kiri, recorder) = kiri(vec![]);
    for args in [json!({ "audible": "yes" }), json!({ "audible": true, "origin": "x" }), json!(null)] {
        let reply = dispatch(&kiri, VIEW, "https://a.example/", json!({ "v": 1, "cap": "media", "method": "state", "args": args }));
        assert_eq!(reply.unwrap_err().name, "TypeError");
    }
    let reply = dispatch(&kiri, VIEW, "https://a.example/", json!({ "v": 1, "cap": "media", "method": "mute" }));
    assert_eq!(reply.unwrap_err().name, "NotSupportedError");
    assert!(recorder.signals.lock().unwrap().is_empty());
}

#[test]
fn unknown_capabilities_are_not_supported() {
    let (kiri, _) = kiri(vec![]);
    let reply = dispatch(&kiri, VIEW, "https://a.example/", json!({ "v": 1, "cap": "bluetooth", "method": "request-device" }));
    assert_eq!(reply.unwrap_err().name, "NotSupportedError");
}

#[test]
fn only_prefixed_views_are_served() {
    let (kiri, recorder) = kiri(vec![]);
    for view in ["main", "misty-agent-1", "misty-browse"] {
        let reply = dispatch(&kiri, view, "https://a.example/", json!({ "v": 1, "cap": "media", "method": "state", "args": { "audible": true } }));
        assert_eq!(reply.unwrap_err().name, "SecurityError", "{view}");
    }
    assert!(recorder.signals.lock().unwrap().is_empty());
}

#[test]
fn powerful_capabilities_need_a_secure_context_and_a_grant() {
    let (kiri, _) = kiri(vec!["https://granted.example"]);
    let call = json!({ "v": 1, "cap": "powerful", "method": "use" });
    assert_eq!(dispatch(&kiri, VIEW, "http://granted.example/", call.clone()).unwrap_err().name, "SecurityError");
    assert_eq!(dispatch(&kiri, VIEW, "https://other.example/", call.clone()).unwrap_err().name, "NotAllowedError");
    assert_eq!(
        dispatch(&kiri, VIEW, "https://granted.example/page", call),
        Ok(json!({ "origin": "https://granted.example" }))
    );
}

#[test]
fn page_script_installs_every_shim_once() {
    let script = page_script();
    assert!(!script.contains("__KIRI_CAPABILITIES__"));
    assert_eq!(script.matches("signal('media', 'state'").count(), 1);
    assert!(script.contains("plugin:kiri|call"));
    // The transport never navigates to report; navigations can cancel page loads.
    assert!(!script.contains("location.href"));
}
