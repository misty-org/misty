//! One native snapshot of a browser profile's website data: cookies plus each
//! origin's sign-in storage. Items that cannot sync are skipped and reported, while
//! items synced by devices that can hold them are carried, never deleted.
use super::super::browser_data_budget::{fit, Candidate, Held, Limit};
use super::super::browser_signin_scope::scoped;
use super::super::browser_data_coverage::{identity, Coverage};
use super::super::{browser_cookie_store, browser_website_capture};
use misty_browser_sync::{
    document::{
        credentials::{Area, Cookie},
        CredentialRecord,
    },
    store::BrowserObservation,
};
use std::collections::BTreeSet;

/// The engine store itself could not be read (not a single bad cookie).
pub(super) const COOKIES_UNREADABLE: &str = "Native cookie observation failed";

/// Keeps which step failed. The kind is a fieldless enum, so no cookie or
/// platform error text can reach the renderer through it.
fn cookies_unreadable(error: browser_cookie_store::CookieStoreError) -> String {
    format!("{COOKIES_UNREADABLE}: {error:?}")
}

pub(super) struct Collected {
    pub observations: Vec<BrowserObservation>,
    pub held: Held,
    pub coverage: Coverage,
}

pub(super) async fn collect(
    app: &tauri::AppHandle,
    view: &tauri::Webview,
    physical: &str,
    previous: &[CredentialRecord],
    extra: Option<(tauri::Webview, Vec<String>)>,
    limit: Limit,
) -> Result<Collected, String> {
    let mut coverage = Coverage::default();
    let mut cookies = browser_cookie_store::read(view, physical)
        .await
        .map_err(cookies_unreadable)?;
    let baseline: Vec<Cookie> = previous
        .iter()
        .filter(|record| matches!(record.area, Area::Cookies))
        .filter_map(|record| serde_json::from_value::<Vec<Cookie>>(record.payload.clone()).ok())
        .flatten()
        .collect();
    cookies.align_same_site(
        &baseline,
        browser_cookie_store::SAME_SITE_NONE_IS_UNSPECIFIED,
    );
    let local: BTreeSet<_> = cookies.cookies.iter().map(identity).collect();
    cookies.carry(&baseline, browser_cookie_store::representable);
    let carried = cookies
        .cookies
        .iter()
        .map(identity)
        .filter(|cookie| !local.contains(cookie))
        .collect();
    cookies.record(&mut coverage);
    let storage =
        browser_website_capture::capture(app, physical, previous, extra, &mut coverage).await?;
    // Only sign-in storage syncs; a copy synced before that is trimmed too.
    let candidates = storage
        .candidates
        .into_iter()
        .filter_map(|candidate| {
            let previous = candidate.previous.and_then(|v| scoped(&candidate.area, &v));
            let fresh = match candidate.fresh {
                // Read, but no longer signed in: the area goes, rather than
                // its last synced token standing in for it.
                Some(v) => Some(scoped(&candidate.area, &v)?),
                // Unreadable this pass: the last synced copy stands in.
                None => None,
            };
            (fresh.is_some() || previous.is_some()).then_some(Candidate {
                area: candidate.area,
                fresh,
                previous,
            })
        })
        .collect();
    let mut fitted = fit(
        cookies.cookies,
        &carried,
        candidates,
        &mut coverage,
        limit,
    )?;
    fitted.held.databases = storage.held_databases;
    Ok(Collected {
        observations: fitted.observations,
        held: fitted.held,
        coverage,
    })
}
