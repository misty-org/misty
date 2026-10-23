//! Checking the stores for newer versions of installed extensions.
use super::*;

#[tauri::command]
pub async fn extensions_check_updates(
    caller: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<InstalledState>, ExtensionFailure> {
    let result: Result<_, String> = async {
        let space = native::caller_space(&caller)?;
        let _guard = lifecycle().lock().await;
        let (account, installations) = {
            let state = service(&space).lock().await;
            (
                state.account.clone(),
                state
                    .desired
                    .values()
                    .filter(|v| v.installed)
                    .cloned()
                    .collect::<Vec<_>>(),
            )
        };
        for installation in installations {
            let result = async {
                let latest = match cancellable(
                    ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire),
                    catalog::latest(&installation.id),
                )
                .await
                {
                    // The store took it down: stop running it everywhere it loaded.
                    Err(error) if error == catalog::REMOVED => {
                        service(&space)
                            .lock()
                            .await
                            .removed
                            .insert(installation.id.clone());
                        return Ok(Some(activate(&app, &account, &space, &installation).await?));
                    }
                    result => result?,
                };
                let current = read_review(&selected_package(
                    &root(&app, &account, &space)?
                        .join("packages")
                        .join(&installation.id),
                    false,
                )?)?;
                if current.entry.digest == latest.digest {
                    return Ok::<_, String>(None);
                }
                let review = prepare(&app, &account, &space, &installation.id).await?;
                if review.blocked
                    || review
                        .permissions
                        .iter()
                        .any(|p| !installation.permissions.contains(p))
                    || review.hosts.iter().any(|p| !installation.hosts.contains(p))
                {
                    return Ok(Some(InstalledState {
                        new_tab: None,
                        id: installation.id.clone(),
                        status: "needs-review".into(),
                        version: Some(current.entry.version),
                        detail: Some("An update needs permission review.".into()),
                        review: Some(review),
                    }));
                }
                commit(&app, &space, &review.token).await?;
                Ok(Some(activate(&app, &account, &space, &installation).await?))
            }
            .await;
            match result {
                Ok(Some(status)) => {
                    service(&space)
                        .lock()
                        .await
                        .states
                        .insert(installation.id.clone(), status);
                }
                Err(error) => {
                    if let Some(status) = service(&space)
                        .lock()
                        .await
                        .states
                        .get_mut(&installation.id)
                    {
                        status.detail = Some(format!("Could not check for updates: {error}"));
                    }
                }
                _ => {}
            }
        }
        crate::infra::space_windows::emit_to_space(
            &app,
            &space,
            "misty://extensions",
            json!({"kind":"changed","account":account,"space":space}),
        );
        Ok(service(&space)
            .lock()
            .await
            .states
            .values()
            .cloned()
            .collect())
    }
    .await;
    result.map_err(ExtensionFailure::from)
}
