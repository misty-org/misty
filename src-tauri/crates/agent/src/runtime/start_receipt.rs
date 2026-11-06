//! No in-memory lock: all workers coordinate through the admitted Misty run. Ported from
//! `start-receipt.ts`.
use std::future::Future;

use super::{
    control_plane::{ControlPlane, RuntimeIdentity},
    js_json::JsValue,
    runtime_errors::RuntimeError,
    tool_transport::string,
};

pub(crate) const HARNESS_VERSION: &str = "vercel-workflow/1";

/// `start_with_receipt`'s identity carries no runtime ID yet: the server hands out the original one,
/// or `submit` makes one.
pub(crate) async fn start_with_receipt<F, Fut>(control: &dyn ControlPlane, identity: &RuntimeIdentity, receipt_callback: &str, submit: F) -> Result<String, RuntimeError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<String, RuntimeError>>,
{
    let claim_payload = || {
        let callback = if receipt_callback.is_empty() { identity.control_plane_url.as_str() } else { receipt_callback };
        vec![("adapter_version".to_owned(), string(HARNESS_VERSION)), ("callback_url".to_owned(), string(callback))]
    };
    let run_id = &identity.misty_run_id;
    let receipt = control.request(identity, "start-receipt", JsValue::Object(claim_payload()), format!("{run_id}:start-claim")).await?;
    let text = |name: &str| receipt.get(name).and_then(JsValue::as_str).filter(|text| !text.is_empty());
    if let Some(runtime_run_id) = text("runtime_run_id") {
        return Ok(runtime_run_id.to_owned());
    }
    let claim_token = text("claim_token").filter(|_| receipt.get("claimed") == Some(&JsValue::Bool(true)));
    let Some(claim_token) = claim_token else {
        return Err(RuntimeError::error("workflow_start_unconfirmed: awaiting the original runtime identity"));
    };
    // An engine exception may follow a committed submission. Do not release the claim: later
    // delivery recovers the activation binding or reports uncertainty.
    let runtime_run_id = submit().await?;
    let mut record = claim_payload();
    record.push(("claim_token".to_owned(), string(claim_token)));
    record.push(("runtime_run_id".to_owned(), string(runtime_run_id.as_str())));
    control.request(identity, "start-receipt", JsValue::Object(record), format!("{run_id}:start-record")).await?;
    Ok(runtime_run_id)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    };

    use futures_util::future::BoxFuture;

    use super::*;
    use crate::runtime::control_plane::RunKey;

    /// Answers in order, and keeps what it was asked.
    #[derive(Default)]
    struct Scripted {
        answers: Mutex<Vec<Result<&'static str, &'static str>>>,
        calls: Mutex<Vec<JsValue>>,
    }

    impl ControlPlane for Scripted {
        fn request<'a>(&'a self, _: &'a RuntimeIdentity, _: &'static str, payload: JsValue, _: String) -> BoxFuture<'a, Result<JsValue, RuntimeError>> {
            self.calls.lock().unwrap().push(payload);
            let answer = self.answers.lock().unwrap().remove(0);
            Box::pin(async move { answer.map(|text| JsValue::parse(text).unwrap()).map_err(RuntimeError::error) })
        }
    }

    fn identity() -> RuntimeIdentity {
        RuntimeIdentity { misty_run_id: "invocation-test".into(), runtime_run_id: String::new(), control_plane_url: "https://api.test".into(), run_key: RunKey::new("k".into()) }
    }

    fn plane(answers: Vec<Result<&'static str, &'static str>>) -> Scripted {
        Scripted { answers: Mutex::new(answers), ..Scripted::default() }
    }

    #[tokio::test]
    async fn records_the_engine_identity_before_acknowledging_a_new_submission() {
        let control = plane(vec![Ok(r#"{"claimed":true,"claim_token":"exclusive"}"#), Ok(r#"{"runtime_run_id":"engine-1"}"#)]);
        let submits = AtomicU32::new(0);
        let started = start_with_receipt(&control, &identity(), "", || async {
            submits.fetch_add(1, Ordering::SeqCst);
            Ok("engine-1".to_owned())
        })
        .await;
        assert_eq!(started.unwrap(), "engine-1");
        let calls = control.calls.lock().unwrap();
        assert_eq!(calls[1].get("claim_token").unwrap().as_str(), Some("exclusive"));
        assert_eq!(calls[1].get("runtime_run_id").unwrap().as_str(), Some("engine-1"));
        assert_eq!(submits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn recovers_a_lost_response_without_resubmitting_the_engine_run() {
        let control = plane(vec![Ok(r#"{"claimed":false,"runtime_run_id":"engine-1"}"#)]);
        let started = start_with_receipt(&control, &identity(), "", || async { panic!("must not submit") }).await;
        assert_eq!(started.unwrap(), "engine-1");
    }

    #[tokio::test]
    async fn does_not_reclaim_an_ambiguous_submission_after_the_worker_crashes() {
        let submits = AtomicU32::new(0);
        let submit = || async {
            submits.fetch_add(1, Ordering::SeqCst);
            Ok("engine-1".to_owned())
        };
        let first = plane(vec![Ok(r#"{"claimed":true,"claim_token":"exclusive"}"#), Err("receipt response lost")]);
        assert_eq!(start_with_receipt(&first, &identity(), "", submit).await.unwrap_err().to_string(), "receipt response lost");
        let second = plane(vec![Ok(r#"{"claimed":false}"#)]);
        let error = start_with_receipt(&second, &identity(), "", submit).await.unwrap_err();
        assert!(error.to_string().contains("workflow_start_unconfirmed"));
        assert_eq!(submits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn does_not_submit_on_a_lost_claim_response_or_release_a_claim_on_engine_failure() {
        let submits = AtomicU32::new(0);
        let lost = plane(vec![Err("claim response lost")]);
        let error = start_with_receipt(&lost, &identity(), "", || async {
            submits.fetch_add(1, Ordering::SeqCst);
            Ok(String::new())
        })
        .await;
        assert_eq!(error.unwrap_err().to_string(), "claim response lost");
        assert_eq!(submits.load(Ordering::SeqCst), 0);
        let claimed = plane(vec![Ok(r#"{"claimed":true,"claim_token":"exclusive"}"#)]);
        let error = start_with_receipt(&claimed, &identity(), "", || async { Err(RuntimeError::error("engine response lost")) }).await;
        assert_eq!(error.unwrap_err().to_string(), "engine response lost");
        assert_eq!(claimed.calls.lock().unwrap().len(), 1);
    }
}
