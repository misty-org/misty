//! What the person approved for each extension on this device.
//!
//! Installations sync through the account's settings, which the server stores
//! in plain text. Without a local record, whoever could write those settings (a
//! compromised server or a stolen session) could install an extension on every
//! device, or widen an installed one to every site and to private tabs. An
//! extension therefore loads here only within what was approved on this device:
//! installing or reviewing it, accepting its permission request, or allowing
//! private tabs. Anything wider waits for review. This file is never synced.
use super::*;
use std::collections::BTreeSet;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Approval {
    permissions: BTreeSet<String>,
    hosts: BTreeSet<String>,
    private_access: bool,
}

type Ledger = BTreeMap<String, Approval>;

fn path(app: &tauri::AppHandle, account: &str) -> Result<PathBuf, String> {
    Ok(root(app, account)?.join("approvals.json"))
}

fn read(path: &Path) -> Option<Ledger> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn write(path: &Path, ledger: &Ledger) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid extension storage.")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    std::fs::write(
        temporary.path(),
        serde_json::to_vec(ledger).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Adds to what the person approved for one extension on this device.
pub(super) fn record(
    app: &tauri::AppHandle,
    account: &str,
    guid: &str,
    permissions: &[String],
    hosts: &[String],
    private_access: bool,
) -> Result<(), String> {
    let path = path(app, account)?;
    let mut ledger = read(&path).unwrap_or_default();
    let approval = ledger.entry(guid.to_owned()).or_default();
    approval.permissions.extend(permissions.iter().cloned());
    approval.hosts.extend(hosts.iter().cloned());
    approval.private_access |= private_access;
    write(&path, &ledger)
}

/// Before this ledger existed, every installation with a package on this
/// device had been installed here. Those are approved once, as they stand.
pub(super) fn seed_existing(
    app: &tauri::AppHandle,
    account: &str,
    installations: &[Installation],
) -> Result<(), String> {
    let path = path(app, account)?;
    if path.exists() {
        return Ok(());
    }
    let packages = root(app, account)?.join("packages");
    let ledger: Ledger = installations
        .iter()
        .filter(|item| {
            item.installed && selected_package(&packages.join(item.id.to_string()), false).is_ok()
        })
        .map(|item| (item.guid.clone(), approval_of(item)))
        .collect();
    write(&path, &ledger)
}

fn approval_of(installation: &Installation) -> Approval {
    Approval {
        permissions: installation.permissions.iter().cloned().collect(),
        hosts: installation.hosts.iter().cloned().collect(),
        private_access: installation.private_access,
    }
}

/// Whether the synced installation stays within this device's approval.
pub(super) fn covers(app: &tauri::AppHandle, account: &str, installation: &Installation) -> bool {
    path(app, account)
        .ok()
        .and_then(|path| read(&path))
        .and_then(|ledger| ledger.get(&installation.guid).cloned())
        .is_some_and(|approved| within(&approved, installation))
}

pub(super) fn within(approved: &Approval, installation: &Installation) -> bool {
    installation
        .permissions
        .iter()
        .all(|value| approved.permissions.contains(value))
        && installation
            .hosts
            .iter()
            .all(|value| approved.hosts.contains(value))
        && (!installation.private_access || approved.private_access)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installation(permissions: &[&str], hosts: &[&str], private_access: bool) -> Installation {
        Installation {
            id: 1,
            guid: "addon@example.com".into(),
            generation: uuid::Uuid::new_v4().to_string(),
            name: "Addon".into(),
            installed: true,
            enabled: true,
            private_access,
            agent_access: true,
            permissions: permissions.iter().map(|value| value.to_string()).collect(),
            hosts: hosts.iter().map(|value| value.to_string()).collect(),
        }
    }

    #[test]
    fn synced_installations_cannot_widen_what_this_device_approved() {
        let approved = approval_of(&installation(
            &["storage", "tabs"],
            &["https://example.com/*"],
            false,
        ));
        assert!(within(&approved, &installation(&["storage"], &[], false)));
        assert!(within(
            &approved,
            &installation(&["storage", "tabs"], &["https://example.com/*"], false)
        ));
        assert!(!within(
            &approved,
            &installation(&["storage", "cookies"], &[], false)
        ));
        assert!(!within(
            &approved,
            &installation(&["storage"], &["<all_urls>"], false)
        ));
        assert!(!within(&approved, &installation(&["storage"], &[], true)));
    }
}
