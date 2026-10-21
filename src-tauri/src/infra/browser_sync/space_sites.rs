//! "Open these sites in this Space": the sites a Space claims for links from other
//! apps. They live in the Space's vault (`space_settings`, sealed like every record)
//! and are copied to the Space registry so links route while the vault is locked.
use super::*;
use misty_browser_sync::{
    collections::SPACE_SETTINGS,
    document::{
        entities::{self, Kind, SpaceSites},
        ViewRecord,
    },
};
use serde_json::Value;

/// The one record a Space vault keeps its sites in.
const SITES_RECORD: &str = "sites";
const LOCKED: &str = "Unlock sync to change which sites open in this Space.";
const UNSAVED: &str = "The sites couldn't be saved. Try again.";
/// How often an open vault's sites are read again for changes from other devices.
const REREAD: std::time::Duration = std::time::Duration::from_secs(60);

/// The open vault of a Space: `None` names the personal Space.
async fn space_handle(space_id: Option<&str>) -> Option<WorkerHandle> {
    let slot = {
        let all = sessions();
        match space_id {
            None => all
                .personal
                .as_ref()
                .and_then(|vault| all.vaults.get(vault)),
            Some(id) => all
                .vaults
                .values()
                .find(|entry| entry.space_id.as_deref() == Some(id)),
        }
        .map(|entry| entry.slot.clone())
    };
    lock_slot(slot).await.as_ref().map(|s| s.handle.clone())
}

async fn read(handle: &WorkerHandle) -> Option<Vec<String>> {
    let (_, records) = handle.records_list(SPACE_SETTINGS.into()).await.ok()?;
    Some(
        records
            .into_iter()
            .find(|record| record.kind == Kind::SpaceSites && record.id == SITES_RECORD)
            .and_then(|record| {
                serde_json::from_value::<SpaceSites>(Value::Object(
                    record.fields.into_iter().collect(),
                ))
                .ok()
            })
            .map(|sites| sites.hosts)
            .unwrap_or_default(),
    )
}

/// Hosts as typed (`example.com`, `https://mail.example.com/…`): lowercased, without
/// `www.`, deduplicated and capped.
pub(crate) fn normalize_sites(sites: &[String]) -> Vec<String> {
    let mut hosts = Vec::new();
    for site in sites {
        let value = site.trim().to_ascii_lowercase();
        if value.is_empty() {
            continue;
        }
        let address = if value.contains("://") {
            value
        } else {
            format!("https://{value}")
        };
        let Some(host) = url::Url::parse(&address)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
        else {
            continue;
        };
        let host = host.strip_prefix("www.").unwrap_or(&host).to_owned();
        if entities::site_host(&host) && !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    hosts.truncate(entities::MAX_SPACE_SITES);
    hosts
}

fn space_key(space_id: &str, personal: bool) -> Result<String, String> {
    crate::infra::space_windows::space_key(space_id, personal)
}

/// Copies a Space vault's sites into the registry once its collections arrive, then
/// again now and then for changes made on other devices, until the vault closes.
pub(super) fn watch(handle: WorkerHandle, space_id: Option<String>) {
    let key = match &space_id {
        None => crate::infra::space_windows::PERSONAL.to_owned(),
        Some(id) => match space_key(id, false) {
            Ok(key) => key,
            Err(_) => return,
        },
    };
    tokio::spawn(async move {
        let mut ready = false;
        loop {
            if !ready {
                match handle.records_ready(SPACE_SETTINGS.into()).await {
                    Ok(true) => ready = true,
                    Ok(false) => {}
                    Err(_) => return,
                }
            }
            if ready {
                let Some(sites) = read(&handle).await else {
                    return;
                };
                crate::infra::space_windows::set_space_sites(&key, sites);
            }
            tokio::time::sleep(if ready {
                REREAD
            } else {
                std::time::Duration::from_secs(2)
            })
            .await;
        }
    });
}

/// The sites a Space claims: from its vault, or as last read while it is locked.
#[tauri::command]
pub async fn browser_sync_space_sites(
    webview: tauri::Webview,
    space_id: String,
    personal: bool,
) -> Result<Vec<String>, String> {
    require_main(&webview)?;
    let key = space_key(&space_id, personal)?;
    let handle = space_handle((!personal).then_some(space_id.as_str())).await;
    if let Some(handle) = handle {
        if handle
            .records_ready(SPACE_SETTINGS.into())
            .await
            .unwrap_or(false)
        {
            if let Some(sites) = read(&handle).await {
                crate::infra::space_windows::set_space_sites(&key, sites);
            }
        }
    }
    Ok(crate::infra::space_windows::space_sites(&key))
}

/// Saves the sites a Space claims to its vault. Returns them as stored.
#[tauri::command]
pub async fn browser_sync_set_space_sites(
    webview: tauri::Webview,
    space_id: String,
    personal: bool,
    sites: Vec<String>,
) -> Result<Vec<String>, String> {
    require_main(&webview)?;
    if sites.len() > 1000 {
        return Err("That's too many sites for one Space.".into());
    }
    let key = space_key(&space_id, personal)?;
    let handle = space_handle((!personal).then_some(space_id.as_str()))
        .await
        .ok_or(LOCKED)?;
    let hosts = normalize_sites(&sites);
    let record = if hosts.is_empty() {
        None
    } else {
        let Value::Object(fields) = serde_json::to_value(SpaceSites {
            hosts: hosts.clone(),
        })
        .map_err(|_| UNSAVED)?
        else {
            return Err(UNSAVED.into());
        };
        let fields: entities::Fields = fields.into_iter().collect();
        entities::validate(Kind::SpaceSites, &fields).map_err(|_| UNSAVED)?;
        Some(ViewRecord {
            kind: Kind::SpaceSites,
            id: SITES_RECORD.into(),
            fields,
        })
    };
    handle
        .records_write(SPACE_SETTINGS.into(), vec![(SITES_RECORD.into(), record)])
        .await
        .map_err(|_| UNSAVED)?;
    crate::infra::space_windows::set_space_sites(&key, hosts.clone());
    Ok(hosts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_sites_become_hosts() {
        let typed = [
            " Example.com ",
            "https://www.example.com/path",
            "mail.example.com",
            "",
            "not a site",
            "http://[::1]/",
        ]
        .map(String::from);
        assert_eq!(
            normalize_sites(&typed),
            vec!["example.com".to_owned(), "mail.example.com".to_owned()]
        );
    }
}
