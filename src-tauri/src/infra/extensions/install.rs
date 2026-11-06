//! Downloading, reviewing and committing an extension package before it loads.
use super::*;
use crate::infra::file_access::fs;

/// Fills in what the review asks for beyond what the person already approved here.
fn with_added(mut review: package::Review, profile_scope: &str) -> Result<package::Review, String> {
    let approval = approvals::read(profile_scope, &review.entry.id)?.unwrap_or_default();
    (review.added_permissions, review.added_hosts) = approval.added(&review);
    Ok(review)
}

pub(super) async fn prepare(
    app: &tauri::AppHandle,
    account: &str,
    profile: &str,
    id: &str,
) -> Result<package::Review, String> {
    let epoch = ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire);
    let scope = sync::journal_scope(account, profile);
    let entry = cancellable(epoch, catalog::latest(id)).await?;
    {
        let state = service(profile).lock().await;
        if state.account != account {
            return Err("The extension account changed.".into());
        }
        for path in state.prepared.values() {
            if let Ok(review) = read_review(path) {
                if review.entry.id == entry.id && review.entry.digest == entry.digest {
                    return with_added(review, &scope);
                }
            }
        }
    }
    let bytes = cancellable(epoch, catalog::bytes(&entry.download_url, 64 * 1024 * 1024)).await?;
    let token = uuid::Uuid::new_v4().to_string();
    let path = root(app, account, profile)?.join("staging").join(&token);
    let staging = path.clone();
    let prepared_token = token.clone();
    let mut review = tauri::async_runtime::spawn_blocking(move || {
        let result = package::extract(&bytes, entry, &staging, prepared_token);
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())??;
    let native_review = cancellable(
        epoch,
        native::request(
            json!({"operation":"validate","account":account,"space":profile,"runtimePath":path.join("runtime")}),
        ),
    )
    .await;
    let native_review = match native_review {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&path);
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
    fs::write(
        path.join("review.json"),
        serde_json::to_vec(&review).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut state = service(profile).lock().await;
    if state.account != account || ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire) != epoch
    {
        let _ = fs::remove_dir_all(&path);
        return Err("The account changed during download.".into());
    }
    state.prepared.insert(token, path);
    with_added(review, &scope)
}

#[tauri::command]
pub async fn extensions_prepare(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<package::Review, ExtensionFailure> {
    let result: Result<_, String> = async {
        let profile = native::caller_profile(&caller)?;
        let account = service(&profile).lock().await.account.clone();
        if account.is_empty() {
            return Err("Sign in to install extensions.".into());
        }
        prepare(&app, &account, &profile, &id).await
    }
    .await;
    result.map_err(ExtensionFailure::from)
}

/// Commits a reviewed package. `approved` is the person's answer to Misty's review of this
/// token, and records exactly what the review on disk lists, never a list from the caller.
/// Without it the package must stay within what they approved before, so an update asking for
/// more, or anything a synced list started, can't get past here.
pub(super) async fn commit(
    app: &tauri::AppHandle,
    profile: &str,
    token: &str,
    approved: bool,
) -> Result<package::Review, String> {
    let (account, path) = {
        let state = service(profile).lock().await;
        (
            state.account.clone(),
            state
                .prepared
                .get(token)
                .cloned()
                .ok_or("This installation review expired. Download the extension again.")?,
        )
    };
    let review = read_review(&path)?;
    if review.blocked {
        return Err("This extension requires unavailable browser APIs.".into());
    }
    let scope = sync::journal_scope(&account, profile);
    if approved {
        approvals::approve(&scope, &review.entry.id, &review.permissions, &review.hosts)?;
    } else if approvals::needs_review(approvals::read(&scope, &review.entry.id)?.as_ref(), &review)
    {
        return Err("This extension's access hasn't been approved on this computer.".into());
    }
    service(profile).lock().await.prepared.remove(token);
    let package = root(app, &account, profile)?
        .join("packages")
        .join(&review.entry.id);
    fs::create_dir_all(&package).map_err(|e| e.to_string())?;
    let digest = review
        .entry
        .digest
        .strip_prefix("sha256:")
        .ok_or("Invalid package digest.")?
        .to_ascii_lowercase();
    let versions = package.join("versions");
    fs::create_dir_all(&versions).map_err(|e| e.to_string())?;
    let destination = versions.join(&digest);
    if fs::exists(&destination) {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        fs::rename(&path, &destination).map_err(|e| e.to_string())?;
    }
    // Loaded views keep their immutable resource directory throughout activation.
    let old: PackageSelection = fs::read(package.join("selection.json"))
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
    fs::write(
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

#[tauri::command]
pub async fn extensions_commit(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    token: String,
    generation: Option<String>,
    approved: bool,
) -> Result<package::Review, ExtensionFailure> {
    let result: Result<_, String> = async {
        let profile = native::caller_profile(&caller)?;
        let _guard = lifecycle().lock().await;
        if generation
            .as_ref()
            .is_some_and(|value| uuid::Uuid::parse_str(value).is_err())
        {
            return Err("Invalid installation generation.".into());
        }
        let review = commit(&app, &profile, &token, approved).await?;
        if let Some(generation) = generation {
            let state = service(&profile).lock().await;
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
                    &profile,
                    &Installation {
                        id: review.entry.id.clone(),
                        guid: review.entry.guid.clone(),
                        generation,
                        name: review.entry.name.clone(),
                        installed: true,
                        enabled: true,
                        // The package's own manifest decides, never the caller.
                        private_access: review.private_allowed,
                        // Agents may not use a new extension until the person allows it.
                        agent_access: false,
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
