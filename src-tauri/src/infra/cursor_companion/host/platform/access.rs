//! Whether the person has allowed the microphone and screen capture.
#[cfg(target_os = "macos")]
pub fn microphone_access() -> Result<(), String> {
    use objc2::{msg_send, runtime::AnyClass};
    use objc2_foundation::NSString;
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVMediaTypeAudio: *const NSString;
    }
    let device_class =
        AnyClass::get(c"AVCaptureDevice").ok_or("The microphone capture API is unavailable.")?;
    unsafe {
        let status: isize =
            msg_send![device_class, authorizationStatusForMediaType: AVMediaTypeAudio];
        if status == 3 {
            return Ok(());
        }
        if status != 0 {
            return Err("Allow Misty in System Settings → Privacy & Security → Microphone.".into());
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let block = block2::RcBlock::new(move |allowed: objc2::runtime::Bool| {
            let _ = tx.send(allowed.as_bool());
        });
        let _: () = msg_send![device_class, requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*block];
        if rx
            .recv_timeout(std::time::Duration::from_secs(60))
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err("Microphone access was not granted. Hold the shortcut again after enabling it in System Settings.".into())
        }
    }
}
/// Windows keeps the microphone switches in the capability consent store:
/// one for the whole device and one for desktop apps such as Misty. Either
/// set to "Deny" blocks the input stream with an unhelpful error, so the
/// person is told which switch to turn on instead.
#[cfg(windows)]
pub fn microphone_access() -> Result<(), String> {
    use crate::platform::shared_windows::registry::read_string;
    const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
    let denied = |key: &str| {
        read_string(key, "Value")
            .ok()
            .flatten()
            .is_some_and(|value| value.eq_ignore_ascii_case("Deny"))
    };
    if denied(STORE) {
        return Err("Microphone access is off. Turn it on in Windows Settings → Privacy & security → Microphone.".into());
    }
    if denied(&format!(r"{STORE}\NonPackaged")) {
        return Err("Desktop apps can't use the microphone. Turn on \"Let desktop apps access your microphone\" in Windows Settings → Privacy & security → Microphone.".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn screen_access() -> Result<(), String> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    unsafe {
        if CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() {
            Ok(())
        } else {
            Err("Allow Misty in System Settings → Privacy & Security → Screen Recording, then retry.".into())
        }
    }
}
#[cfg(windows)]
pub fn screen_access() -> Result<(), String> {
    Ok(())
}
