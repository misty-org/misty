//! First worker: a journalled import into the live store, then a native
//! generation staged, activated and reverified against changed cookies.
use misty_browser_sync::{
    document::{self, credentials::Area},
    restore::{
        restore_profile, restore_staged_profile, verify_active_profile, QuiescentProfile,
        RestoreOutcome,
    },
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
    target: &serde_json::Value,
    generation_views: &mut Vec<Webview>,
) -> Result<()> {
    // A complete cookie area removes cookies absent from the target.
    let mut retired = fixture();
    retired.name = "retired-synthetic-token".into();
    write(a, a_id, retired, false).await?;
    let mut backend = StagedCookieProfile::new(a.clone(), a_id.to_owned());
    let mut partitioned = fixture();
    partitioned.name = "partitioned-synthetic-token".into();
    partitioned.partition_key = Some(document::credentials::PartitionKey {
        top_level_site: "https://example.test".into(),
        has_cross_site_ancestor: false,
    });
    let rejected = document::CredentialRecord {
        sequence: 1,
        profile_id: a_id.into(),
        area: Area::Cookies,
        payload: serde_json::json!([fixture(), partitioned]),
    };
    if backend.preflight(&[rejected]).await.is_ok() {
        return Err("partitioned cookies were silently broadened");
    }
    let unsupported_storage = document::CredentialRecord {
        sequence: 1,
        profile_id: a_id.into(),
        area: Area::LocalStorage {
            origin: "https://example.test".into(),
        },
        payload: serde_json::json!({}),
    };
    if backend.preflight(&[unsupported_storage]).await.is_ok() {
        return Err("cookie adapter acknowledged unsupported storage");
    }
    let unchanged = read(a, a_id).await?;
    if unchanged.len() != 1 || unchanged[0].name != "retired-synthetic-token" {
        return Err("unsupported preflight changed browser cookies");
    }
    if !matches!(
        restore_profile(&handle, a_id, &mut backend)
            .await
            .map_err(|_| "journalled native restore failed")?,
        RestoreOutcome::Applied { sequence: 1 }
    ) {
        return Err("wrong imported cursor");
    }
    let actual =
        serde_json::to_value(read(a, a_id).await?).map_err(|_| "probe readback encoding")?;
    if Area::Cookies
        .canonical_payload(&actual)
        .map_err(|_| "probe actual format")?
        != Area::Cookies
            .canonical_payload(&target)
            .map_err(|_| "probe target format")?
    {
        return Err("journalled cookie attributes changed");
    }
    if !read(b, b_id).await?.is_empty() {
        return Err("restore crossed profile boundary");
    }
    handle
        .imports_applied(1)
        .await
        .map_err(|_| "verified import not acknowledged")?;
    let generation = uuid::Uuid::new_v4().to_string();
    let binding = handle
        .stage_browser_profile(a_id.into(), 0, generation.clone())
        .await
        .map_err(|_| "allocate first generation")?;
    let physical = binding
        .staged
        .as_ref()
        .ok_or("missing first stage")?
        .physical_id
        .clone();
    let view = generation_view(a, &physical)?;
    generation_views.push(view.clone());
    let mut isolated =
        StagedCookieProfile::for_generation(view.clone(), a_id.into(), physical.clone());
    restore_staged_profile(&handle, a_id, &generation, &mut isolated)
        .await
        .map_err(|_| "restore allocated first generation")?;
    if handle.imports_applied(1).await.is_ok() {
        return Err("staged profile was marked ready before activation");
    }
    handle
        .activate_browser_profile(a_id.into(), binding.revision, generation)
        .await
        .map_err(|_| "activate first generation")?;
    if read(&view, &physical).await?.len() != 1 || read(a, a_id).await?.len() != 1 {
        return Err("generation activation lost its own or predecessor cookies");
    }
    verify_active_profile(&handle, a_id, &mut isolated)
        .await
        .map_err(|_| "activated native profile could not be reverified")?;
    let original = read(&view, &physical)
        .await?
        .into_iter()
        .next()
        .ok_or("missing active cookie")?;
    let mut changed = original.clone();
    changed.value = "native-value-changed-after-receipt".into();
    write(&view, &physical, changed.clone(), false).await?;
    if verify_active_profile(&handle, a_id, &mut isolated)
        .await
        .is_ok()
    {
        return Err("durable receipt substituted for changed native cookie observations");
    }
    if read(&view, &physical)
        .await?
        .first()
        .map(|cookie| &cookie.value)
        != Some(&changed.value)
    {
        return Err("active verification overwrote native browser state");
    }
    write(&view, &physical, original, false).await?;
    verify_active_profile(&handle, a_id, &mut isolated)
        .await
        .map_err(|_| "restored native observation could not be reverified")?;
    handle
        .imports_applied(1)
        .await
        .map_err(|_| "activated generation not acknowledged")?;
    Ok(())
}
