//! Asking the person at this computer to prove it's them, before a saved card is filled: Touch ID
//! or the Mac's password, or Windows Hello. Where that isn't possible, the answer is no.
use tauri::Window;

const UNAVAILABLE: &str = "Set up a password or sign-in on this computer to fill saved cards.";
const NOT_CONFIRMED: &str = "Your card wasn't filled because you weren't confirmed.";
const CANCELED: &str = "Your card wasn't filled.";

/// `reason` finishes the sentence "Misty is trying to …" on macOS.
#[cfg(target_os = "macos")]
pub async fn confirm(_window: &Window, reason: &str) -> Result<(), String> {
    use std::ffi::{c_char, c_int, c_void, CString};
    use tokio::sync::oneshot;

    extern "C" {
        fn misty_local_auth_confirm(
            reason: *const c_char,
            context: *mut c_void,
            done: extern "C" fn(*mut c_void, c_int),
        );
    }
    extern "C" fn finished(context: *mut c_void, outcome: c_int) {
        // Safety: `context` is the box leaked below, and the native side calls this exactly once.
        let sender = unsafe { Box::from_raw(context.cast::<oneshot::Sender<c_int>>()) };
        let _ = sender.send(outcome);
    }

    let reason = CString::new(reason.replace('\0', "")).map_err(|_| CANCELED.to_owned())?;
    let (sender, receiver) = oneshot::channel::<c_int>();
    let context = Box::into_raw(Box::new(sender)).cast::<c_void>();
    // Safety: the native side copies `reason` before returning and calls `finished` once.
    unsafe { misty_local_auth_confirm(reason.as_ptr(), context, finished) };
    match receiver.await {
        Ok(0) => Ok(()),
        Ok(1) => Err(CANCELED.to_owned()),
        Ok(2) => Err(UNAVAILABLE.to_owned()),
        _ => Err(NOT_CONFIRMED.to_owned()),
    }
}

/// The prompt names the window it belongs to, so it opens over Misty rather than behind it.
#[cfg(windows)]
pub async fn confirm(window: &Window, reason: &str) -> Result<(), String> {
    use windows::{
        core::{factory, HSTRING},
        Security::Credentials::UI::{
            UserConsentVerificationResult as Outcome, UserConsentVerifier,
        },
        Win32::{Foundation::HWND, System::WinRT::IUserConsentVerifierInterop},
    };
    use windows_future::IAsyncOperation;

    let hwnd = window.hwnd().map_err(|_| UNAVAILABLE.to_owned())?.0 as isize;
    let reason = HSTRING::from(reason);
    let outcome = tokio::task::spawn_blocking(move || {
        let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
        // Safety: the window outlives the prompt, and the prompt only reads the handle.
        let operation: IAsyncOperation<Outcome> =
            unsafe { interop.RequestVerificationForWindowAsync(HWND(hwnd as _), &reason)? };
        operation.get()
    })
    .await
    .map_err(|_| NOT_CONFIRMED.to_owned())?
    .map_err(|_| UNAVAILABLE.to_owned())?;
    match outcome {
        Outcome::Verified => Ok(()),
        Outcome::Canceled => Err(CANCELED.to_owned()),
        Outcome::DeviceNotPresent | Outcome::NotConfiguredForUser | Outcome::DisabledByPolicy => {
            Err(UNAVAILABLE.to_owned())
        }
        _ => Err(NOT_CONFIRMED.to_owned()),
    }
}

/// No system prompt to ask through here, so saved cards don't fill.
#[cfg(not(any(target_os = "macos", windows)))]
pub async fn confirm(_window: &Window, _reason: &str) -> Result<(), String> {
    Err(UNAVAILABLE.to_owned())
}
