//! Asks the person to confirm with Touch ID or this Mac's password before Misty fills a saved card.

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LAContext, LAError, LAPolicy};
use std::{ptr::NonNull, sync::Mutex};

/// Outcomes, as `browser/autofill` reads them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    Confirmed,
    Canceled,
    Unavailable,
    Failed,
}

/// `done` is called exactly once, on any thread. macOS words the prompt as
/// "Misty is trying to <reason>".
pub(crate) fn confirm(reason: &str, done: impl FnOnce(Outcome) + Send + 'static) {
    // SAFETY: `LAContext` is thread safe, and every call below follows its documented contract.
    unsafe {
        let auth = LAContext::new();
        let why = NSString::from_str(reason);
        if auth
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
            .is_err()
        {
            done(Outcome::Unavailable);
            return;
        }
        let done = Mutex::new(Some(done));
        let reply = RcBlock::new(move |success: Bool, failure: *mut NSError| {
            let Some(done) = done.lock().ok().and_then(|mut done| done.take()) else {
                return;
            };
            if success.as_bool() {
                return done(Outcome::Confirmed);
            }
            // SAFETY: on failure LocalAuthentication passes a valid `NSError` for this call.
            let code = NonNull::new(failure).map(|error| error.as_ref().code());
            let canceled = [
                LAError::UserCancel,
                LAError::SystemCancel,
                LAError::AppCancel,
            ]
            .iter()
            .any(|cancel| code == Some(cancel.0));
            done(if canceled {
                Outcome::Canceled
            } else {
                Outcome::Failed
            });
        });
        auth.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthentication,
            &why,
            &reply,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shows the real Touch ID prompt and prints what the person did. Run by hand:
    /// `cargo test -p misty-native touch_id_prompt -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs a person at the Touch ID sensor"]
    fn touch_id_prompt() {
        let (send, receive) = std::sync::mpsc::channel();
        confirm("fill a saved card", move |outcome| {
            let _ = send.send(outcome);
        });
        let outcome = receive
            .recv_timeout(std::time::Duration::from_secs(60))
            .expect("no answer in 60 seconds");
        println!("Touch ID outcome: {outcome:?}");
        assert_ne!(outcome, Outcome::Failed);
    }
}
