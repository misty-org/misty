//! Journaling the storage changes extensions report, for the next sync pass.
use super::*;

pub(super) fn safe_change(key: &str, value: &Value) -> bool {
    key.len() <= 8192
        && value.to_string().len() + key.len() <= 8192
        && value.as_object().is_some_and(|v| {
            (v.len() == 1 && v.get("deleted") == Some(&Value::Bool(true)))
                || (v.len() == 1 && v.contains_key("value"))
        })
}

pub async fn observe(app: &tauri::AppHandle, event: Value) {
    if event["session"].as_u64() != Some(ACCOUNT_EPOCH.load(Ordering::Acquire)) {
        return;
    }
    let Some(account) = event["account"].as_str() else {
        return;
    };
    let Some(space) = event["space"].as_str() else {
        return;
    };
    let scope = journal_scope(account, space);
    let Some(id) = event["id"]
        .as_str()
        .filter(|v| super::super::catalog::Store::of(v).is_some())
        .map(str::to_owned)
    else {
        return;
    };
    let installation = {
        let state = service(space).lock().await;
        if state.account != account {
            return;
        }
        state
            .desired
            .get(&id)
            .filter(|v| v.installed && v.enabled)
            .cloned()
    };
    let Some(installation) = installation else {
        return;
    };
    let _guard = journal_lock().lock().await;
    {
        let state = service(space).lock().await;
        if state.account != account || state.desired.get(&id) != Some(&installation) {
            return;
        }
    }
    let result = (|| {
        let mut journal = read(app, &scope, &installation)?;
        let changes: BTreeMap<String, Value> = if event["kind"] == "sync-ready" {
            let values = event["payload"]["values"]
                .as_object()
                .ok_or("The extension sync bridge is not ready.")?;
            let mut changes = BTreeMap::new();
            for (key, value) in values {
                if journal.values.get(key) != Some(value) {
                    changes.insert(key.clone(), json!({"value":value}));
                }
            }
            for key in journal.values.keys() {
                if !values.contains_key(key) {
                    changes.insert(key.clone(), json!({"deleted":true}));
                }
            }
            changes
        } else {
            serde_json::from_value(event["payload"]["changes"].clone())
                .map_err(|_| "Could not read the extension's storage changes.")?
        };
        if changes.len() > 512 || changes.iter().any(|(k, v)| !safe_change(k, v)) {
            return Err("Extension sync storage exceeds its quota.".into());
        }
        for (key, change) in changes {
            if change["deleted"] == true {
                journal.values.remove(&key);
            } else {
                journal.values.insert(key.clone(), change["value"].clone());
            }
            if journal.initialized {
                journal.pending.insert(key, change);
            }
        }
        if journal.values.len() > 512
            || serde_json::to_vec(&journal.values)
                .map_err(|e| e.to_string())?
                .len()
                > 102_400
        {
            return Err("Extension sync storage exceeds its quota.".into());
        }
        write(app, &scope, &installation, &journal)
    })();
    if result.is_ok() && event["kind"] == "sync-ready" {
        if let Ok(mut ready) = ready().lock() {
            ready.insert(readiness_key(account, space, &id));
        }
        // Previously restored local data remains usable while the vault is locked.
        if read(app, &scope, &installation).is_ok_and(|journal| journal.initialized) {
            let _ = native::request(
                json!({"operation":"sync-restored","account":account,"space":space,"id":id}),
            )
            .await;
        }
    }
    if result.is_err() {
        crate::infra::space_windows::emit_to_space(
            app,
            space,
            "misty://extensions",
            json!({"kind":"sync-status","account":account,"space":space,"id":id,"detail":"Extension settings could not be saved for sync. Retry after checking sync access."}),
        );
    }
}
