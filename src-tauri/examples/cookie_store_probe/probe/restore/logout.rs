//! Second worker, after a restart: a logout restored into a fresh generation,
//! then native observations captured and coalesced while offline.
use misty_browser_sync::{
    document::{credentials::Area, Document},
    restore::{restore_staged_profile, RestoreOutcome},
    store::{BrowserCaptureState, BrowserObservation},
    worker::WorkerHandle,
};

use super::super::*;
use crate::website_data::cookie_restore::StagedCookieProfile;

pub(super) async fn run(
    handle: &WorkerHandle,
    a: &Webview,
    b: &Webview,
    a_id: &str,
    b_id: &str,
    generation_views: &mut Vec<Webview>,
) -> Result<()> {
    if handle.imports_applied(2).await.is_ok() {
        return Err("old receipt covered newer logout");
    }
    let before = handle
        .browser_profile_binding(a_id.into())
        .await
        .map_err(|_| "recover generation binding")?;
    let previous = before
        .active
        .as_ref()
        .ok_or("active generation lost on restart")?
        .physical_id
        .clone();
    let generation = uuid::Uuid::new_v4().to_string();
    let binding = handle
        .stage_browser_profile(a_id.into(), before.revision, generation.clone())
        .await
        .map_err(|_| "allocate logout generation")?;
    let physical = binding
        .staged
        .as_ref()
        .ok_or("missing logout stage")?
        .physical_id
        .clone();
    let view = generation_view(a, &physical)?;
    generation_views.push(view.clone());
    // Seed a stale cookie so the empty area must actually remove data.
    write(&view, &physical, fixture(), false).await?;
    let mut backend =
        StagedCookieProfile::for_generation(view.clone(), a_id.into(), physical.clone());
    if !matches!(
        restore_staged_profile(&handle, a_id, &generation, &mut backend)
            .await
            .map_err(|_| "native logout restore failed")?,
        RestoreOutcome::Applied { sequence: 2 }
    ) {
        return Err("wrong logout cursor");
    }
    if !read(&view, &physical).await?.is_empty() {
        return Err("native logout retained cookies");
    }
    if read(&generation_views[0], &previous).await?.len() != 1 {
        return Err("staged logout changed previous generation");
    }
    let activated = handle
        .activate_browser_profile(a_id.into(), binding.revision, generation)
        .await
        .map_err(|_| "activate logout generation")?;
    if activated.retired.len() != 1 || activated.retired[0].physical_id != previous {
        return Err("activation discarded recoverable predecessor");
    }
    handle
        .imports_applied(2)
        .await
        .map_err(|_| "logout receipt not acknowledged")?;
    let active_generation = activated
        .active
        .as_ref()
        .ok_or("missing capture generation")?;
    for value in ["first-native-observation", "latest-native-observation"] {
        let mut cookie = fixture();
        cookie.value = value.into();
        write(&view, &physical, cookie, false).await?;
        let actual = read(&view, &physical).await?;
        if handle
            .observe_browser_profile(
                a_id.into(),
                active_generation.id.clone(),
                vec![BrowserObservation {
                    area: Area::Cookies,
                    payload: serde_json::to_value(actual).map_err(|_| "encode native capture")?,
                }],
            )
            .await
            .map_err(|_| "capture native observation")?
            != BrowserCaptureState::Queued
        {
            return Err("native cookie observation was not queued");
        }
        let pending = handle
            .pending_snapshot()
            .await
            .map_err(|_| "capture outbox snapshot")?;
        if pending.operation_ids.len() != 1 {
            return Err("offline native observations were not coalesced");
        }
        let document: Document =
            serde_json::from_slice(&pending.snapshot).map_err(|_| "decode captured document")?;
        let captured = document
            .credentials
            .values()
            .find(|record| record.profile_id == a_id)
            .ok_or("missing captured cookie area")?;
        if captured.payload[0]["value"] != "first-native-observation" {
            return Err("coalesced observation replaced an unacknowledged operation");
        }
    }
    if !read(b, b_id).await?.is_empty() {
        return Err("native capture changed another profile");
    }
    Ok(())
}
