//! Explicit native handoff. The task owns the account/profile write lifetime
//! even when its renderer invocation is canceled during a profile switch.
use super::*;

mod capture;
#[cfg(test)]
use capture::initial_capture;
#[cfg(any(target_os = "macos", windows))]
pub(super) use capture::capture_current;
mod restore;
#[cfg(all(test, any(target_os = "macos", windows)))]
use restore::check_restore_mode;
#[cfg(any(target_os = "macos", windows))]
pub(super) use restore::{restore_current, RestoreMode, RESTORE_DEFERRED};

use misty_browser_sync::{
    document::{credentials::Area, CredentialRecord},
    worker::Phase,
};

pub(super) fn supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        objc2_foundation::NSProcessInfo::processInfo()
            .operatingSystemVersion()
            .majorVersion
            >= 14
    }
    #[cfg(windows)]
    {
        true
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        false
    }
}

fn cookie_target(document: &Document, logical: &str) -> Result<Vec<CredentialRecord>, String> {
    let target: Vec<_> = document
        .credentials
        .values()
        .filter(|v| v.profile_id == logical)
        .cloned()
        .collect();
    if target.is_empty() {
        return Err("This workspace has no captured website sign-ins to restore yet.".into());
    }
    if !target
        .iter()
        .any(|record| matches!(record.area, Area::Cookies))
    {
        return Err("This workspace has no captured website cookies yet.".into());
    }
    // Cookies this device cannot store are left for the devices that can:
    // the restore adapter skips them and reports them back unchanged.
    serde_json::from_value::<Vec<misty_browser_sync::document::credentials::Cookie>>(
        target
            .iter()
            .find(|record| matches!(record.area, Area::Cookies))
            .ok_or("Missing cookies")?
            .payload
            .clone(),
    )
    .map_err(|_| "The received cookie data is invalid")?;
    Ok(target)
}

#[cfg(test)]
mod tests;
