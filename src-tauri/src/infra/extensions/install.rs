//! Downloading, reviewing and committing an extension package before it loads.
use super::*;

pub(super) async fn prepare(
    app: &tauri::AppHandle,
    account: &str,
    id: u64,
) -> Result<package::Review, String> {
    let epoch = ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire);
    let entry = cancellable(epoch, catalog::detail(id)).await?;
    {
        let state = service().lock().await;
        if state.account != account {
            return Err("The extension account changed.".into());
        }
        for path in state.prepared.values() {
            if let Ok(review) = read_review(path) {
                if review.entry.id == id && review.entry.digest == entry.digest {
                    return Ok(review);
                }
            }
        }
    }
    let bytes = cancellable(epoch, catalog::bytes(&entry.download_url, 64 * 1024 * 1024)).await?;
    let token = uuid::Uuid::new_v4().to_string();
    let path = root(app, account)?.join("staging").join(&token);
    let staging = path.clone();
    let prepared_token = token.clone();
    let mut review = tauri::async_runtime::spawn_blocking(move || {
        let result = package::extract(&bytes, entry, &staging, prepared_token);
        if result.is_err() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())??;
    let native_review = cancellable(
        epoch,
        native::request(
            json!({"operation":"validate","account":account,"runtimePath":path.join("runtime")}),
        ),
    )
    .await;
    let native_review = match native_review {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&path);
            return Err(error);
        }
    };
    review.blocked |= native_review["blocked"] == true;
    if let Some(findings) = native_review["findings"].as_array() {
        review
            .findings
            .extend(findings.iter().filter_map(Value::as_str).map(str::to_owned));
    }
    if let Some(platform) = native_review["platform"].as_str() {
        review.findings.push(format!(
            "Native manifest check: {platform}. Runtime behavior remains unverified."
        ));
    }
    if let Some(hosts) = native_review["hosts"].as_array() {
        review
            .hosts
            .extend(hosts.iter().filter_map(Value::as_str).map(str::to_owned));
        review.hosts.sort();
        review.hosts.dedup();
    }
    std::fs::write(
        path.join("review.json"),
        serde_json::to_vec(&review).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut state = service().lock().await;
    if state.account != account || ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire) != epoch
    {
        let _ = std::fs::remove_dir_all(&path);
        return Err("The account changed during download.".into());
    }
    state.prepared.insert(token, path);
    Ok(review)
}

#[tauri::command]
pub async fn extensions_prepare(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    id: u64,
) -> Result<package::Review, ExtensionFailure> {
    let result: Result<_, String> = async {
        native::trusted(&caller)?;
        let account = service().lock().await.account.clone();
        if account.is_empty() {
            return Err("Sign in to install extensions.".into());
        }
        prepare(&app, &account, id).await
    }
    .await;
    result.map_err(ExtensionFailure::from)
}

pub(super) async fn commit(app: &tauri::AppHandle, token: &str) -> Result<package::Review, String> {
    let (account, path) = {
        let mut state = service().lock().await;
        (
            state.account.clone(),
            state
                .prepared
                .remove(token)
                .ok_or("This installation review expired. Download the extension again.")?,
        )
    };
    let review = read_review(&path)?;
    if review.blocked {
        return Err("This extension requires unavailable browser APIs.".into());
    }
    let package = root(app, &account)?
        .join("packages")
        .join(review.entry.id.to_string());
    std::fs::create_dir_all(&package).map_err(|e| e.to_string())?;
    let digest = review
        .entry
        .digest
        .strip_prefix("sha256:")
        .ok_or("Invalid package digest.")?
        .to_ascii_lowercase();
    let versions = package.join("versions");
    std::fs::create_dir_all(&versions).map_err(|e| e.to_string())?;
    let destination = versions.join(&digest);
    if destination.exists() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        std::fs::rename(&path, &destination).map_err(|e| e.to_string())?;
    }
    // Loaded views keep their immutable resource directory throughout activation.
    let old: PackageSelection = std::fs::read(package.join("selection.json"))
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_default();
    let selection = PackageSelection {
        current: digest.clone(),
        previous: if old.current == digest {
            old.previous
        } else {
            (!old.current.is_empty()).then_some(old.current)
        },
    };
    let temporary = tempfile::NamedTempFile::new_in(&package).map_err(|e| e.to_string())?;
    std::fs::write(
        temporary.path(),
        serde_json::to_vec(&selection).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary
        .persist(package.join("selection.json"))
        .map_err(|e| e.to_string())?;
    Ok(review)
}

/// Records access the person granted on this device outside an install: an
/// extension's permission request, or allowing it in private tabs.
#[tauri::command]
pub async fn extensions_approve(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    guid: String,
    permissions: Vec<String>,
    hosts: Vec<String>,
    private_access: bool,
) -> Result<(), ExtensionFailure> {
    let result: Result<_, String> = async {
        native::trusted(&caller)?;
        if guid.is_empty()
            || guid.len() > 256
            || permissions.len() > 256
            || hosts.len() > 2048
            || permissions
                .iter()
                .chain(&hosts)
                .any(|value| value.len() > 8192 || value.contains('\0'))
        {
            return Err("Invalid extension approval.".into());
        }
        let account = service().lock().await.account.clone();
        if account.is_empty() {
            return Err("Sign in to manage extensions.".into());
        }
        approvals::record(&app, &account, &guid, &permissions, &hosts, private_access)
    }
    .await;
    result.map_err(ExtensionFailure::from)
}

#[tauri::command]
pub async fn extensions_commit(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    token: String,
    generation: Option<String>,
    private_access: Option<bool>,
) -> Result<package::Review, ExtensionFailure> {
    let result: Result<_, String> = async {
        native::trusted(&caller)?;
        let _guard = lifecycle().lock().await;
        if generation
            .as_ref()
            .is_some_and(|value| uuid::Uuid::parse_str(value).is_err())
        {
            return Err("Invalid installation generation.".into());
        }
        let review = commit(&app, &token).await?;
        // The person reviewed this package here; record what they approved.
        let account = service().lock().await.account.clone();
        approvals::record(
            &app,
            &account,
            &review.entry.guid,
            &review.permissions,
            &review.hosts,
            review.private_allowed && private_access.unwrap_or(false),
        )?;
        if let Some(generation) = generation {
            let state = service().lock().await;
            if !state
                .desired
                .get(&review.entry.id)
                .is_some_and(|value| value.installed)
            {
                let account = state.account.clone();
                drop(state);
                sync::seed_local(
                    &app,
                    &account,
                    &Installation {
                        id: review.entry.id,
                        guid: review.entry.guid.clone(),
                        generation,
                        name: review.entry.name.clone(),
                        installed: true,
                        enabled: true,
                        private_access: review.private_allowed,
                        agent_access: true,
                        permissions: review.permissions.clone(),
                        hosts: review.hosts.clone(),
                    },
                )
                .await?;
            }
        }
        Ok(review)
    }
    .await;
    result.map_err(ExtensionFailure::from)
}
