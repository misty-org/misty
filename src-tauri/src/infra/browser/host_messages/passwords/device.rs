//! Saved passwords crossing between this device's local vault and the signed-in account's
//! synced vault (docs/design/no-account-browsing/BRIEF.md): turning on sync brings the
//! local ones into the account, and signing out keeps a copy on the device, or erases it.
use super::manage::require_main;
use super::*;
use crate::infra::browser_sync::{device_vault_handle, synced_vault_handle};
use misty_browser_sync::worker::WorkerHandle;

const UNAVAILABLE: &str = "Saved passwords on this device could not be opened.";

async fn list(handle: &WorkerHandle) -> Result<Vec<ViewRecord>, String> {
    let (_, records) = handle
        .records_list(PASSWORDS.into())
        .await
        .map_err(|_| UNAVAILABLE.to_owned())?;
    Ok(records
        .into_iter()
        .filter(|record| record.kind == Kind::Login)
        .collect())
}

fn text(record: &ViewRecord, field: &str) -> String {
    record
        .fields
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn updated_at(record: &ViewRecord) -> i64 {
    record
        .fields
        .get("updated_at")
        .and_then(Value::as_i64)
        .unwrap_or_default()
}

/// What `from` adds to `into`: sign-ins `into` lacks, and newer passwords for ones it has
/// (same site and username). Duplicates are skipped.
fn merge_writes(from: &[ViewRecord], into: &[ViewRecord]) -> Vec<(String, Option<ViewRecord>)> {
    from.iter()
        .filter_map(|record| {
            let existing = into.iter().find(|candidate| {
                text(candidate, "origin") == text(record, "origin")
                    && text(candidate, "username") == text(record, "username")
            });
            match existing {
                None => Some((record.id.clone(), Some(record.clone()))),
                Some(existing)
                    if updated_at(record) > updated_at(existing)
                        && text(record, "password") != text(existing, "password") =>
                {
                    let mut newer = record.clone();
                    newer.id = existing.id.clone();
                    Some((existing.id.clone(), Some(newer)))
                }
                Some(_) => None,
            }
        })
        .collect()
}

async fn copy(from: &WorkerHandle, into: &WorkerHandle) -> Result<usize, String> {
    let writes = merge_writes(&list(from).await?, &list(into).await?);
    let count = writes.len();
    if count > 0 {
        into.records_write(PASSWORDS.into(), writes)
            .await
            .map_err(|_| "Saved passwords could not be copied. Try again.".to_owned())?;
    }
    Ok(count)
}

async fn erase(handle: &WorkerHandle) -> Result<(), String> {
    let writes: Vec<(String, Option<ViewRecord>)> = list(handle)
        .await?
        .into_iter()
        .map(|record| (record.id, None))
        .collect();
    if writes.is_empty() {
        return Ok(());
    }
    handle
        .records_write(PASSWORDS.into(), writes)
        .await
        .map_err(|_| "Saved passwords could not be removed. Try again.".to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePasswordsPreview {
    /// Sign-ins on this device that the account's vault lacks or has older.
    passwords: usize,
    /// The account's vault already has sign-ins, so it syncs from somewhere else.
    account_has_passwords: bool,
}

/// What turning on sync would bring from this device into the account. Zero while no synced
/// vault is open.
#[tauri::command]
pub async fn browser_passwords_device_preview(
    webview: Webview,
) -> Result<DevicePasswordsPreview, String> {
    require_main(&webview)?;
    let (Some(synced), Some(device)) = (synced_vault_handle().await, device_vault_handle().await)
    else {
        return Ok(DevicePasswordsPreview {
            passwords: 0,
            account_has_passwords: false,
        });
    };
    let into = list(&synced).await?;
    Ok(DevicePasswordsPreview {
        passwords: merge_writes(&list(&device).await?, &into).len(),
        account_has_passwords: !into.is_empty(),
    })
}

/// Brings this device's saved passwords into the account's synced vault, then clears the
/// device's copy: from now on they live in the account.
#[tauri::command]
pub async fn browser_passwords_device_merge(webview: Webview) -> Result<usize, String> {
    require_main(&webview)?;
    let synced = synced_vault_handle()
        .await
        .ok_or_else(|| "Turn on sync before adding this device's passwords.".to_owned())?;
    let device = device_vault_handle()
        .await
        .ok_or_else(|| UNAVAILABLE.to_owned())?;
    let added = copy(&device, &synced).await?;
    erase(&device).await?;
    Ok(added)
}

/// Before signing out: keeps a copy of the account's saved passwords on this device, so
/// browsing without an account still fills them; or, with `remove`, erases the device's.
#[tauri::command]
pub async fn browser_passwords_device_keep(webview: Webview, remove: bool) -> Result<(), String> {
    require_main(&webview)?;
    let device = device_vault_handle()
        .await
        .ok_or_else(|| UNAVAILABLE.to_owned())?;
    if remove {
        return erase(&device).await;
    }
    if let Some(synced) = synced_vault_handle().await {
        copy(&synced, &device).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn login(
        id: &str,
        origin: &str,
        username: &str,
        password: &str,
        updated_at: i64,
    ) -> ViewRecord {
        let fields = serde_json::json!({
            "origin": origin,
            "username": username,
            "password": password,
            "created_at": 1,
            "updated_at": updated_at,
        });
        let Value::Object(fields) = fields else {
            unreachable!()
        };
        ViewRecord {
            kind: Kind::Login,
            id: id.into(),
            fields: fields.into_iter().collect(),
        }
    }

    #[test]
    fn adds_missing_sign_ins_and_skips_duplicates() {
        let from = [
            login("login:a", "https://a.test", "me", "one", 5),
            login("login:b", "https://b.test", "me", "two", 5),
        ];
        let into = [login("login:x", "https://a.test", "me", "one", 9)];
        let writes = merge_writes(&from, &into);
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, "login:b");
    }

    #[test]
    fn a_newer_password_replaces_the_older_under_its_id() {
        let from = [login("login:a", "https://a.test", "me", "new", 9)];
        let into = [login("login:x", "https://a.test", "me", "old", 5)];
        let writes = merge_writes(&from, &into);
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, "login:x");
        let record = writes[0].1.as_ref().expect("a write");
        assert_eq!(text(record, "password"), "new");
        assert_eq!(record.id, "login:x");
    }

    #[test]
    fn an_older_password_never_replaces_a_newer_one() {
        let from = [login("login:a", "https://a.test", "me", "old", 5)];
        let into = [login("login:x", "https://a.test", "me", "new", 9)];
        assert!(merge_writes(&from, &into).is_empty());
    }
}
