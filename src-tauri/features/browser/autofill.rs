//! Asking the person at this computer to prove it's them, before a saved card is filled: Touch ID
//! or the Mac's password, or Windows Hello. Where that isn't possible, the answer is no.
use tauri::Window;

#[cfg(target_os = "macos")]
mod macos;

const UNAVAILABLE: &str = "Set up a password or sign-in on this computer to fill saved cards.";
const NOT_CONFIRMED: &str = "Your card wasn't filled because you weren't confirmed.";
const CANCELED: &str = "Your card wasn't filled.";

/// `reason` finishes the sentence "Misty is trying to …" on macOS.
#[cfg(target_os = "macos")]
pub async fn confirm(_window: &Window, reason: &str) -> Result<(), String> {
    use macos::local_auth::{confirm, Outcome};
    use tokio::sync::oneshot;

    let (sender, receiver) = oneshot::channel::<Outcome>();
    confirm(&reason.replace('\0', ""), move |outcome| {
        let _ = sender.send(outcome);
    });
    match receiver.await {
        Ok(Outcome::Confirmed) => Ok(()),
        Ok(Outcome::Canceled) => Err(CANCELED.to_owned()),
        Ok(Outcome::Unavailable) => Err(UNAVAILABLE.to_owned()),
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
