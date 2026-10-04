//! One sync pass for an installation: restore remote values, then publish the
//! journal's pending changes.
use super::*;

pub(super) async fn pass(
    app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
    handle: &misty_browser_sync::worker::WorkerHandle,
) -> Result<(), String> {
    let epoch = ACCOUNT_EPOCH.load(Ordering::Acquire);
    if !ready()
        .lock()
        .map_err(|_| "The extension sync bridge is unavailable.")?
        .contains(&readiness_key(account, installation.id))
    {
        return Ok(());
    }
    {
        let state = service().lock().await;
        if state.account != account || state.desired.get(&installation.id) != Some(installation) {
            return Ok(());
        }
    }
    if !handle
        .records_ready(EXTENSION_SYNC.into())
        .await
        .map_err(|e| e.to_string())?
    {
        return Ok(());
    }
    let _guard = journal_lock().lock().await;
    if !current(account, installation, epoch).await {
        return Ok(());
    }
    let mut journal = read(app, account, installation)?;
    let (_, records) = handle
        .records_list(EXTENSION_SYNC.into())
        .await
        .map_err(|e| e.to_string())?;
    if !current(account, installation, epoch).await {
        return Ok(());
    }
    if records.iter().any(|r| {
        r.kind == Kind::ExtensionRemoval
            && r.fields.get("extension").and_then(Value::as_str) == Some(&installation.guid)
            && r.fields.get("generation").and_then(Value::as_str) == Some(&installation.generation)
    }) {
        // Removal records have their own IDs and are never extension-writable.
        // A stale settings update or offline storage edit cannot erase them.
        forget(account, installation.id);
        let _=native::request(json!({"operation":"remove","account":account,"id":installation.id.to_string(),"guid":installation.guid})).await;
        if !current(account, installation, epoch).await {
            return Ok(());
        }
        remove_local(app, account, installation)?;
        if let Ok(mut origins) = origins().write() {
            origins.remove(&uuid_for(&format!("{account}:{}", installation.guid)));
        }
        let mut state = service().lock().await;
        if state.account == account {
            state.loaded.remove(&installation.id);
            state.states.remove(&installation.id);
            if let Some(intent) = state.desired.get_mut(&installation.id) {
                if intent.generation == installation.generation {
                    intent.installed = false;
                }
            }
        }
        drop(state);
        let _=app.emit_to("main","misty://extensions",json!({"kind":"uninstalled","account":account,"id":installation.id,"generation":installation.generation}));
        return Ok(());
    }
    let matching = |r: &&ViewRecord| {
        r.kind == Kind::ExtensionSyncKey
            && r.fields.get("extension").and_then(Value::as_str) == Some(&installation.guid)
            && r.fields.get("generation").and_then(Value::as_str) == Some(&installation.generation)
    };
    let mut remote = BTreeMap::new();
    for record in records.iter().filter(matching) {
        if let (Some(key), Some(change)) = (
            record.fields.get("key").and_then(Value::as_str),
            record.fields.get("change"),
        ) {
            if safe_change(key, change) && !journal.pending.contains_key(key) {
                remote.insert(key.to_owned(), change.clone());
            }
        }
    }
    let mut merged = journal.values.clone();
    for (key, change) in &remote {
        if change["deleted"] == true {
            merged.remove(key);
        } else {
            merged.insert(key.clone(), change["value"].clone());
        }
    }
    if merged.len() > 512
        || serde_json::to_vec(&merged)
            .map_err(|e| e.to_string())?
            .len()
            > 102_400
    {
        return Err("Synced extension settings exceed the storage quota.".into());
    }
    if !journal.initialized {
        // First launch: remote keys win over extension-written startup defaults.
        // Defaults absent from the account become initial synced values.
        for (key, value) in &journal.values {
            if !remote.contains_key(key) {
                journal.pending.insert(key.clone(), json!({"value":value}));
            }
        }
        write(app, account, installation, &journal)?;
    }
    let writes: Vec<_> = journal
        .pending
        .iter()
        .map(|(key, change)| {
            let id = identity(&format!(
                "{}:{}:{key}",
                installation.guid, installation.generation
            ));
            let fields = BTreeMap::from([
                ("extension".into(), json!(installation.guid)),
                ("generation".into(), json!(installation.generation)),
                ("key".into(), json!(key)),
                ("change".into(), change.clone()),
            ]);
            (
                id.clone(),
                Some(ViewRecord {
                    kind: Kind::ExtensionSyncKey,
                    id,
                    fields,
                }),
            )
        })
        .collect();
    if !writes.is_empty() {
        handle
            .records_write(EXTENSION_SYNC.into(), writes)
            .await
            .map_err(|e| e.to_string())?;
        if !current(account, installation, epoch).await {
            return Ok(());
        }
        journal.pending.clear();
        write(app, account, installation, &journal)?;
    }
    remote.retain(|key, change| {
        if change["deleted"] == true {
            journal.values.contains_key(key)
        } else {
            journal.values.get(key) != Some(&change["value"])
        }
    });
    if !remote.is_empty() {
        native::request(json!({"operation":"sync-apply","account":account,"id":installation.id.to_string(),"changes":remote})).await?;
        if !current(account, installation, epoch).await {
            return Ok(());
        }
        for (key, change) in remote {
            if change["deleted"] == true {
                journal.values.remove(&key);
            } else {
                journal.values.insert(key, change["value"].clone());
            }
        }
        write(app, account, installation, &journal)?;
    }
    if !journal.initialized {
        journal.initialized = true;
        write(app, account, installation, &journal)?;
    }
    native::request(
        json!({"operation":"sync-restored","account":account,"id":installation.id.to_string()}),
    )
    .await?;
    Ok(())
}
