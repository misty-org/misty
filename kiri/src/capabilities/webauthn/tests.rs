use super::*;
use crate::{Caller, Signal};
use serde_json::json;
use std::{
    pin::pin,
    sync::Mutex,
    task::{Context, Poll, Waker},
};

struct NoHost;

impl Host for NoHost {
    fn signal(&self, _caller: &Caller, _signal: Signal) {}
}

#[derive(Default)]
struct Fake {
    created: Mutex<Vec<CreateRequest>>,
    asserted: Mutex<Vec<GetRequest>>,
}

impl Authenticator for Arc<Fake> {
    fn create(&self, request: CreateRequest, _host: Arc<dyn Host>) -> Ceremony<Registration> {
        self.created.lock().unwrap().push(request);
        Box::pin(std::future::ready(Ok(Registration {
            credential_id: b"cred".to_vec(),
            client_data_json: b"{}".to_vec(),
            attestation_object: attestation::tests::es256_attestation(b"cred"),
            attachment: Attachment::Platform,
            transports: vec!["hybrid".into(), "internal".into()],
        })))
    }

    fn get(&self, request: GetRequest, _host: Arc<dyn Host>) -> Ceremony<Assertion> {
        self.asserted.lock().unwrap().push(request);
        Box::pin(std::future::ready(Ok(Assertion {
            credential_id: b"cred".to_vec(),
            client_data_json: b"{}".to_vec(),
            authenticator_data: vec![1, 2, 3],
            signature: vec![4, 5],
            user_handle: None,
            attachment: Attachment::CrossPlatform,
        })))
    }

    fn cancel(&self, _host: Arc<dyn Host>) {}
}

fn run<F: Future>(future: F) -> F::Output {
    match pin!(future).poll(&mut Context::from_waker(Waker::noop())) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("ceremony suspended"),
    }
}

fn call(fake: &Arc<Fake>, origin: &str, method: &str, args: Value) -> Result<Value, KiriError> {
    let capability = WebAuthn::new(fake.clone());
    let caller = Caller::from_page("misty-browser-1", &url::Url::parse(origin).unwrap()).unwrap();
    run(capability.call(Call {
        caller,
        method: method.into(),
        args,
        host: Arc::new(NoHost),
    }))
}

// "challenge" and "user-id" in base64url.
fn creation(rp_id: Option<&str>) -> Value {
    json!({
        "challenge": "Y2hhbGxlbmdl",
        "rp": { "id": rp_id, "name": "Example" },
        "user": { "id": "dXNlci1pZA", "name": "ada@example.com", "displayName": "Ada" },
        "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }, { "type": "public-key", "alg": -257 }],
        "authenticatorSelection": { "residentKey": "required", "userVerification": "required" },
        "excludeCredentials": [{ "type": "public-key", "id": "b2xk" }],
        "extensions": { "credProps": true },
    })
}

#[test]
fn creation_runs_with_the_callers_origin_and_parsed_options() {
    let fake = Arc::new(Fake::default());
    let reply = call(&fake, "https://accounts.example.com/signup", "create", creation(Some("example.com"))).unwrap();
    let request = fake.created.lock().unwrap().remove(0);
    assert_eq!(request.origin, "https://accounts.example.com");
    assert_eq!(request.rp_id, "example.com");
    assert_eq!(request.challenge, b"challenge");
    assert_eq!(request.user_id, b"user-id");
    assert_eq!(request.algorithms, vec![-7, -257]);
    assert_eq!(request.exclude, vec![b"old".to_vec()]);
    assert_eq!(request.resident_key, "required");
    assert_eq!(request.user_verification, "required");
    assert_eq!(request.attestation, "none");
    assert_eq!(reply["id"], "Y3JlZA");
    assert_eq!(reply["authenticatorAttachment"], "platform");
    assert_eq!(reply["response"]["publicKeyAlgorithm"], -7);
    assert!(reply["response"]["publicKey"].as_str().is_some());
    assert_eq!(reply["response"]["transports"], json!(["hybrid", "internal"]));
}

#[test]
fn rp_id_defaults_to_the_host_and_must_be_owned_and_registrable() {
    let fake = Arc::new(Fake::default());
    call(&fake, "https://login.example.com/", "create", creation(None)).unwrap();
    assert_eq!(fake.created.lock().unwrap()[0].rp_id, "login.example.com");
    for rp_id in ["other.com", "com", "co.uk", "ample.com", "deep.login.example.com"] {
        let origin = if rp_id == "co.uk" { "https://shop.co.uk/" } else { "https://login.example.com/" };
        let error = call(&fake, origin, "create", creation(Some(rp_id))).unwrap_err();
        assert_eq!(error.name, "SecurityError", "{rp_id}");
    }
    assert!(call(&fake, "https://127.0.0.1/", "create", creation(None)).is_err());
}

#[test]
fn malformed_options_are_type_errors() {
    let fake = Arc::new(Fake::default());
    let mut options = creation(None);
    options["user"]["id"] = json!("");
    assert_eq!(call(&fake, "https://example.com/", "create", options).unwrap_err().name, "TypeError");
    let mut options = creation(None);
    options["challenge"] = json!("not base64!");
    assert_eq!(call(&fake, "https://example.com/", "create", options).unwrap_err().name, "TypeError");
    let mut options = creation(None);
    options["pubKeyCredParams"] = json!([{ "type": "public-key", "alg": -999 }]);
    assert_eq!(call(&fake, "https://example.com/", "create", options).unwrap_err().name, "NotSupportedError");
    assert!(fake.created.lock().unwrap().is_empty());
}

#[test]
fn assertions_carry_allow_lists_and_shape_the_reply() {
    let fake = Arc::new(Fake::default());
    let reply = call(
        &fake,
        "https://example.com/login",
        "get",
        json!({ "challenge": "Y2hhbGxlbmdl", "allowCredentials": [{ "type": "public-key", "id": "Y3JlZA" }] }),
    )
    .unwrap();
    let request = fake.asserted.lock().unwrap().remove(0);
    assert_eq!(request.rp_id, "example.com");
    assert_eq!(request.allow, vec![b"cred".to_vec()]);
    assert_eq!(request.user_verification, "preferred");
    assert_eq!(reply["authenticatorAttachment"], "cross-platform");
    assert_eq!(reply["response"]["signature"], "BAU");
    assert_eq!(reply["response"]["userHandle"], Value::Null);
}
