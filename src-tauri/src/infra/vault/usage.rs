//! How much sync takes up, for Settings. The server reports sizes under names it can't read; only
//! here do they become profiles and kinds of data.
use super::*;
use misty_browser_sync::{collections, vault::keys::RecordKeys};
use std::collections::BTreeMap;

/// Every collection sync may hold, so a size can be named. A collection from a newer version shows
/// under "other" rather than being dropped.
const KNOWN: &[&str] = &[
    "tabs",
    "cookies",
    "local_storage",
    profile_data::PAGE_STATE,
    collections::BOOKMARKS,
    collections::TAB_GROUPS,
    collections::HISTORY,
    collections::EXTENSION_SYNC,
    collections::PASSWORDS,
    collections::EXTENSIONS,
    collections::SITE_PERMISSIONS,
    collections::SEARCH,
    collections::DOWNLOADS,
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePart {
    name: String,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultUsage {
    /// What the vault holds on the server.
    bytes: u64,
    /// The account's limit, if one is set.
    limit_bytes: Option<u64>,
    by_profile: Vec<UsagePart>,
    by_kind: Vec<UsagePart>,
    /// Sent and received by this computer over the last 30 days.
    sent_bytes: u64,
    received_bytes: u64,
    /// Items that couldn't sync, by kind.
    set_aside: Vec<UsagePart>,
    /// Sites whose data couldn't sync, and why.
    #[cfg(any(target_os = "macos", windows))]
    site_skips: Vec<site_data::skips::SiteSkip>,
    /// How this computer's checks of each profile's cookies are going.
    #[cfg(any(target_os = "macos", windows))]
    cookie_checks: Vec<CookieCheckRow>,
}

#[cfg(any(target_os = "macos", windows))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CookieCheckRow {
    profile: String,
    check: Option<site_data::skips::CookieCheck>,
}

fn sorted(parts: BTreeMap<String, u64>) -> Vec<UsagePart> {
    let mut parts: Vec<_> = parts
        .into_iter()
        .map(|(name, bytes)| UsagePart { name, bytes })
        .collect();
    parts.sort_by_key(|part| std::cmp::Reverse(part.bytes));
    parts
}

#[tauri::command]
pub async fn vault_usage(webview: tauri::Webview, api_base: String) -> Result<VaultUsage, String> {
    if !profile_windows::is_person_window(webview.window().label()) {
        return Err("Sync is only available in a normal window.".into());
    }
    let (root, vault_id) = {
        let active = ACTIVE.lock().await;
        let active = active
            .as_ref()
            .ok_or("The vault isn't open on this computer.")?;
        (active.root.duplicate(), active.vault_id.clone())
    };
    let server = account_api(&api_base)?
        .usage()
        .await
        .map_err(|_| "Couldn't reach the server. Check your connection and try again.")?;
    let names = RecordKeys::new(&root, &vault_id).map_err(|_| "Sync couldn't start.")?;
    let profiles = profile_windows::listed_profiles();
    let mut lookup: BTreeMap<String, (String, String)> = BTreeMap::new();
    // What isn't any one profile's: Settings names it "All profiles".
    for collection in [profiles::COLLECTION, collections::CLIPBOARD] {
        if let Ok(scope) = names.scope(profiles::LIST_OWNER, collection) {
            lookup.insert(scope, (String::new(), collection.to_owned()));
        }
    }
    for profile in &profiles {
        for collection in KNOWN {
            if let Ok(scope) = names.scope(&profile.id, collection) {
                lookup.insert(scope, (profile.name.clone(), (*collection).to_owned()));
            }
        }
    }
    let (mut by_profile, mut by_kind): (BTreeMap<String, u64>, BTreeMap<String, u64>) =
        Default::default();
    for scope in server.scopes {
        let (profile, kind) = lookup
            .get(&scope.scope)
            .cloned()
            .unwrap_or_else(|| ("Other".to_owned(), "other".to_owned()));
        *by_profile.entry(profile).or_default() += scope.bytes;
        *by_kind.entry(kind).or_default() += scope.bytes;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64);
    let ((sent_bytes, received_bytes), set_aside) =
        with_store(|store| Ok((store.traffic(now)?, store.set_aside_counts()?)))?;
    Ok(VaultUsage {
        bytes: server.bytes,
        limit_bytes: server.limit_bytes,
        by_profile: sorted(by_profile),
        by_kind: sorted(by_kind),
        sent_bytes,
        received_bytes,
        set_aside: set_aside
            .into_iter()
            .map(|(name, bytes)| UsagePart { name, bytes })
            .collect(),
        #[cfg(any(target_os = "macos", windows))]
        site_skips: profiles
            .iter()
            .flat_map(|profile| site_data::coverage(&profile.id))
            .collect(),
        #[cfg(any(target_os = "macos", windows))]
        cookie_checks: profiles
            .iter()
            .map(|profile| CookieCheckRow {
                profile: profile.name.clone(),
                check: site_data::skips::cookie_check(&profile.id),
            })
            .collect(),
    })
}
