//! Checking the stores for newer versions of installed extensions.
use super::*;

#[tauri::command]
pub async fn extensions_check_updates(
    caller: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<InstalledState>, ExtensionFailure> {
    let result: Result<_, String> = async {
        let profile = native::caller_profile(&caller)?;
        let _guard = lifecycle().lock().await;
        let (account, installations) = {
            let state = service(&profile).lock().await;
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
                        service(&profile)
                            .lock()
                            .await
                            .removed
                            .insert(installation.id.clone());
                        return Ok(Some(
                            activate(&app, &account, &profile, &installation).await?,
                        ));
                    }
                    result => result?,
                };
                let current = read_review(&selected_package(
                    &root(&app, &account, &profile)?
                        .join("packages")
                        .join(&installation.id),
                    false,
                )?)?;
                if current.entry.digest == latest.digest {
                    return Ok::<_, String>(None);
                }
                let approval =
                    approvals::read(&sync::journal_scope(&account, &profile), &installation.id)?;
                // Never approved here: it isn't running, and the row in Settings says so.
                if approval.is_none() {
                    return Ok::<_, String>(None);
                }
                let review = prepare(&app, &account, &profile, &installation.id).await?;
                // The old version keeps running until the person answers.
                if approvals::needs_review(approval.as_ref(), &review) {
                    return Ok(Some(InstalledState {
                        new_tab: None,
                        id: installation.id.clone(),
                        status: "needs-review".into(),
                        version: Some(current.entry.version),
                        detail: Some("An update needs permission review.".into()),
                        review: Some(review),
                    }));
                }
                commit(&app, &profile, &review.token, false).await?;
                Ok(Some(
                    activate(&app, &account, &profile, &installation).await?,
                ))
            }
            .await;
            match result {
                Ok(Some(status)) => {
                    service(&profile)
                        .lock()
                        .await
                        .states
                        .insert(installation.id.clone(), status);
                }
                Err(error) => {
                    if let Some(status) = service(&profile)
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
        crate::infra::profile_windows::emit_to_profile(
            &app,
            &profile,
            "misty://extensions",
            json!({"kind":"changed","account":account,"space":profile}),
        );
        Ok(service(&profile)
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
