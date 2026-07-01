use super::{browser_cookie_restore::StagedCookieProfile, browser_website_storage::WebsiteStorage};
use misty_browser_sync::{
    document::{credentials::Area, CredentialRecord},
    restore::{EngineError, QuiescentProfile, StagedProfile},
};

pub(super) struct BrowserProfile {
    cookies: StagedCookieProfile,
    storage: WebsiteStorage,
}
impl BrowserProfile {
    pub fn for_generation(view: tauri::Webview, logical: String, physical: String) -> Self {
        Self {
            cookies: StagedCookieProfile::for_generation(view.clone(), logical, physical.clone()),
            storage: WebsiteStorage::new(view, physical),
        }
    }
}
fn cookies(target: &[CredentialRecord]) -> Vec<CredentialRecord> {
    target
        .iter()
        .filter(|record| matches!(record.area, Area::Cookies))
        .cloned()
        .collect()
}
impl QuiescentProfile for BrowserProfile {
    async fn prepare_ephemeral(&mut self, target: &[CredentialRecord]) -> Result<(), EngineError> {
        // sessionStorage belongs to a browsing context, not the disk profile.
        // Recreate its origin/tab contexts after restart; visible tabs receive
        // the same authenticated values through a one-navigation native script.
        let sessions: Vec<_> = target
            .iter()
            .filter(|record| matches!(record.area, Area::SessionStorage { .. }))
            .cloned()
            .collect();
        self.storage
            .apply(&sessions)
            .await
            .map_err(|_| EngineError::Unavailable)
    }
    async fn preflight(&mut self, target: &[CredentialRecord]) -> Result<(), EngineError> {
        for record in target {
            record
                .area
                .validate_payload(&record.payload)
                .map_err(|_| EngineError::Invalid)?;
        }
        self.cookies.preflight(&cookies(target)).await
    }
    async fn apply(&mut self, target: &[CredentialRecord]) -> Result<(), EngineError> {
        self.storage
            .apply(target)
            .await
            .map_err(|_| EngineError::Unavailable)?;
        self.cookies.apply(&cookies(target)).await
    }
    async fn readback(
        &mut self,
        target: &[CredentialRecord],
    ) -> Result<Vec<CredentialRecord>, EngineError> {
        let mut observed = self.cookies.readback(&cookies(target)).await?;
        observed.extend(
            self.storage
                .readback(target)
                .await
                .map_err(|_| EngineError::Unavailable)?,
        );
        Ok(observed)
    }
}
impl StagedProfile for BrowserProfile {
    fn physical_id(&self) -> &str {
        self.cookies.physical_id()
    }
}
