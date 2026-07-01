//! Cookie implementation of the staged native importer. Construct only for a
//! newly isolated profile that has never navigated. Live profiles need a fresh
//! physical store and explicit reload coordination before using this adapter.
#![allow(dead_code)] // Host profile migration must acquire quiescence first.
use super::browser_cookie_store::{self as cookies, CookieStoreError};
use misty_browser_sync::{
    document::{
        credentials::{Area, Cookie},
        CredentialRecord,
    },
    restore::{EngineError, QuiescentProfile, StagedProfile},
};
use tauri::Webview;

pub(crate) struct StagedCookieProfile {
    view: Webview,
    logical_profile_id: String,
    physical_profile_id: String,
}

impl StagedCookieProfile {
    /// Native host responsibility: the named profile has no other live clients
    /// or workers and remains inaccessible for the duration of the restore.
    pub(crate) fn new(view: Webview, profile_id: String) -> Self {
        Self::for_generation(view, profile_id.clone(), profile_id)
    }

    pub(crate) fn for_generation(
        view: Webview,
        logical_profile_id: String,
        physical_profile_id: String,
    ) -> Self {
        Self {
            view,
            logical_profile_id,
            physical_profile_id,
        }
    }

    fn target(&self, target: &[CredentialRecord]) -> Result<Vec<Cookie>, EngineError> {
        // A cookie-only adapter must not falsely acknowledge local/session
        // storage or IndexedDB, including empty areas representing a logout.
        if target.len() != 1
            || target[0].profile_id != self.logical_profile_id
            || !matches!(target[0].area, Area::Cookies)
        {
            return Err(EngineError::Unsupported);
        }
        Area::Cookies
            .validate_payload(&target[0].payload)
            .map_err(|_| EngineError::Invalid)?;
        serde_json::from_value(target[0].payload.clone()).map_err(|_| EngineError::Invalid)
    }
}

fn issue(error: CookieStoreError) -> EngineError {
    match error {
        CookieStoreError::Timeout => EngineError::Timeout,
        CookieStoreError::Unsupported => EngineError::Unsupported,
        CookieStoreError::Invalid | CookieStoreError::TooLarge => EngineError::Invalid,
        CookieStoreError::Unavailable | CookieStoreError::Profile => EngineError::Unavailable,
    }
}

fn identity(cookie: &Cookie) -> (String, String, bool, String) {
    (
        cookie.name.clone(),
        cookie.domain.trim_start_matches('.').to_owned(),
        cookie.host_only,
        cookie.path.clone(),
    )
}
fn same(a: &Cookie, b: &Cookie) -> Result<bool, EngineError> {
    let canonical = |cookie: &Cookie| {
        Area::Cookies
            .canonical_payload(&serde_json::json!([cookie]))
            .map_err(|_| EngineError::Invalid)
    };
    Ok(canonical(a)? == canonical(b)?)
}
fn live(cookie: &Cookie, now: i64) -> bool {
    cookie
        .expires_unix_seconds
        .is_none_or(|expires| expires > now)
}

impl QuiescentProfile for StagedCookieProfile {
    async fn preflight(&mut self, target: &[CredentialRecord]) -> Result<(), EngineError> {
        let target = self.target(target)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| EngineError::Invalid)?
            .as_secs() as i64;
        // Expired server cookies are tombstoned by time, not native writes.
        let target = target
            .into_iter()
            .filter(|cookie| live(cookie, now))
            .collect();
        cookies::preflight(&self.view, &self.physical_profile_id, target)
            .await
            .map_err(issue)?;
        cookies::read(&self.view, &self.physical_profile_id)
            .await
            .map_err(issue)?;
        Ok(())
    }
    async fn apply(&mut self, target: &[CredentialRecord]) -> Result<(), EngineError> {
        cookies::preflight(&self.view, &self.physical_profile_id, vec![])
            .await
            .map_err(issue)?;
        let target = self.target(target)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| EngineError::Invalid)?
            .as_secs() as i64;
        let target: Vec<_> = target
            .into_iter()
            .filter(|cookie| live(cookie, now))
            .collect();
        let current: std::collections::BTreeMap<_, _> =
            cookies::read(&self.view, &self.physical_profile_id)
                .await
                .map_err(issue)?
                .into_iter()
                .map(|cookie| (identity(&cookie), cookie))
                .collect();
        let target: std::collections::BTreeMap<_, _> = target
            .into_iter()
            .map(|cookie| (identity(&cookie), cookie))
            .collect();
        for (key, cookie) in &current {
            if !target.contains_key(key) {
                cookies::write(&self.view, &self.physical_profile_id, cookie.clone(), true)
                    .await
                    .map_err(issue)?;
            }
        }
        for (key, cookie) in target {
            let unchanged = current
                .get(&key)
                .map(|old| same(old, &cookie))
                .transpose()?
                .unwrap_or(false);
            if !unchanged {
                cookies::write(&self.view, &self.physical_profile_id, cookie, false)
                    .await
                    .map_err(issue)?;
            }
        }
        Ok(())
    }
    async fn readback(
        &mut self,
        target: &[CredentialRecord],
    ) -> Result<Vec<CredentialRecord>, EngineError> {
        self.target(target)?;
        cookies::preflight(&self.view, &self.physical_profile_id, vec![])
            .await
            .map_err(issue)?;
        let observed = cookies::read(&self.view, &self.physical_profile_id)
            .await
            .map_err(issue)?;
        let mut record = target[0].clone();
        record.payload = serde_json::to_value(observed).map_err(|_| EngineError::Invalid)?;
        Ok(vec![record])
    }
}

impl StagedProfile for StagedCookieProfile {
    fn physical_id(&self) -> &str {
        &self.physical_profile_id
    }
}
