//! What website data syncs: every cookie, plus only the storage that holds a
//! sign-in. Sites keep their other local and IndexedDB data on each machine;
//! it is neither published nor overwritten or deleted by a restore.
//! sessionStorage belongs to one tab and does not sync.
use misty_browser_sync::document::{credentials::Area, CredentialRecord};
use serde_json::{json, Value};

/// Lowercase fragments of localStorage keys that hold sign-in state, e.g.
/// Discord `token`, Supabase `sb-*-auth-token`, `msal.*`, `@@auth0spajs@@`.
const KEY_MARKERS: &[&str] = &[
    "token", "auth", "session", "msal", "sb-", "oidc", "oauth", "jwt", "credential", "login",
    "sso", "refresh",
];
/// IndexedDB databases that hold sign-in state (Firebase Auth).
const DATABASES: &[&str] = &["firebaseLocalStorageDb"];
/// Tokens are small; a larger value is application data under a matching name.
const MAX_VALUE: usize = 16 << 10;

/// The scope sent to the page script, so it reads and writes exactly this.
pub(crate) fn page_scope() -> Value {
    json!({"keys": KEY_MARKERS, "databases": DATABASES, "max_value": MAX_VALUE})
}

fn signin_key(key: &str, value: &str) -> bool {
    let key = key.to_ascii_lowercase();
    value.len() <= MAX_VALUE && KEY_MARKERS.iter().any(|marker| key.contains(marker))
}

/// The part of one area that syncs, or `None` when nothing in it does.
pub(crate) fn scoped(area: &Area, payload: &Value) -> Option<Value> {
    match area {
        Area::Cookies => Some(payload.clone()),
        Area::SessionStorage { .. } => None,
        Area::LocalStorage { .. } => {
            let kept: serde_json::Map<_, _> = payload
                .as_object()?
                .iter()
                .filter(|(key, value)| value.as_str().is_some_and(|value| signin_key(key, value)))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            (!kept.is_empty()).then_some(Value::Object(kept))
        }
        Area::IndexedDb { .. } => {
            let mut payload = payload.clone();
            let databases = payload["databases"].as_array_mut()?;
            databases.retain(|db| db["name"].as_str().is_some_and(|name| DATABASES.contains(&name)));
            (!databases.is_empty()).then_some(payload)
        }
    }
}

/// Records narrowed to what syncs. Applied to everything published, loaded or
/// compared, so data synced before the scope existed is trimmed, not restored.
pub(crate) fn scope_records(records: Vec<CredentialRecord>) -> Vec<CredentialRecord> {
    records
        .into_iter()
        .filter_map(|mut record| {
            record.payload = scoped(&record.area, &record.payload)?;
            Some(record)
        })
        .collect()
}

/// Restore leaves data outside the scope alone, so readback reports the
/// requested copy for it: only the in-scope part is compared with the browser.
pub(crate) fn with_unsynced(area: &Area, observed: Value, target: &Value) -> Value {
    match area {
        Area::Cookies => observed,
        Area::SessionStorage { .. } => target.clone(),
        Area::LocalStorage { .. } => {
            let mut merged = observed.as_object().cloned().unwrap_or_default();
            for (key, value) in target.as_object().into_iter().flatten() {
                if !value.as_str().is_some_and(|value| signin_key(key, value)) {
                    merged.insert(key.clone(), value.clone());
                }
            }
            Value::Object(merged)
        }
        Area::IndexedDb { .. } => {
            let mut merged = observed;
            if let Some(databases) = merged["databases"].as_array_mut() {
                databases.extend(
                    target["databases"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|db| !db["name"].as_str().is_some_and(|name| DATABASES.contains(&name)))
                        .cloned(),
                );
                databases.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
            }
            merged
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "https://app.example.test";

    #[test]
    fn cookies_always_sync_whole() {
        let cookies = json!([{"name": "sid"}]);
        assert_eq!(scoped(&Area::Cookies, &cookies), Some(cookies));
    }

    #[test]
    fn local_storage_keeps_only_small_signin_keys() {
        let area = Area::LocalStorage { origin: ORIGIN.into() };
        let payload = json!({
            "token": "discord",
            "sb-abc-auth-token": "supabase",
            "msal.account.keys": "[]",
            "theme": "dark",
            "draft-cache": "x",
            "huge_token": "x".repeat(MAX_VALUE + 1),
        });
        assert_eq!(
            scoped(&area, &payload),
            Some(json!({"token": "discord", "sb-abc-auth-token": "supabase", "msal.account.keys": "[]"}))
        );
        assert_eq!(scoped(&area, &json!({"theme": "dark"})), None);
    }

    #[test]
    fn indexed_db_keeps_only_signin_databases_and_session_storage_is_dropped() {
        let area = Area::IndexedDb { origin: ORIGIN.into() };
        let payload = json!({"codec_version": 1, "databases": [
            {"name": "firebaseLocalStorageDb", "version": 1, "stores": []},
            {"name": "message-cache", "version": 3, "stores": []},
        ]});
        assert_eq!(
            scoped(&area, &payload),
            Some(json!({"codec_version": 1, "databases": [
                {"name": "firebaseLocalStorageDb", "version": 1, "stores": []},
            ]}))
        );
        let session = Area::SessionStorage { origin: ORIGIN.into(), view_id: "tab".into() };
        assert_eq!(scoped(&session, &json!({"token": "t"})), None);
    }

    #[test]
    fn readback_reports_unsynced_data_as_requested() {
        let area = Area::LocalStorage { origin: ORIGIN.into() };
        let target = json!({"token": "t", "theme": "dark"});
        let merged = with_unsynced(&area, json!({"token": "t"}), &target);
        assert_eq!(merged, target);
        // A sign-in key the browser lost is still a difference.
        assert_ne!(with_unsynced(&area, json!({}), &target), target);
    }
}
