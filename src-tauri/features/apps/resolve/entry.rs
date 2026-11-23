use super::*;

pub(super) fn entry_from(
    repo: &Repo,
    release: &Release,
    maker_manifest: Option<RepoManifest>,
) -> Result<(AppEntry, ManifestFrom), String> {
    let upstream = format!("{}/{}", repo.owner.login, repo.name);
    let license = open_source(
        repo.license
            .as_ref()
            .and_then(|license| license.spdx_id.as_deref()),
    )
    .ok_or_else(|| {
        "Its license isn't an open-source one GitHub recognizes, so Misty can't add it.".to_owned()
    })?;
    if release.draft || release.prerelease {
        return Err("Its latest release is a draft or a pre-release.".into());
    }
    let version = version_of(&release.tag_name);
    if !valid_version(&version) {
        return Err(
            "Its latest release's tag isn't a version Misty can name a folder after.".into(),
        );
    }
    let raw = format!(
        "https://raw.githubusercontent.com/{upstream}/{}",
        release.tag_name
    );
    let picture = repo
        .owner
        .avatar_url
        .clone()
        .unwrap_or_else(|| format!("https://github.com/{}.png", repo.owner.login));
    let (
        from,
        id,
        name,
        description,
        maker,
        asset,
        logo,
        mut manifest,
        add_copies,
        strip_top,
        auto_top,
    ) = match maker_manifest {
        Some(theirs) => {
            let file = theirs.web_asset.replace("{version}", &version);
            let asset = release
                .assets
                .iter()
                .find(|asset| asset.name == file)
                .ok_or_else(|| {
                    format!("Its latest release has no {file}, which its misty-app.json names.")
                })?;
            let logo = theirs
                .icon
                .as_deref()
                .map_or(picture, |icon| format!("{raw}/{icon}"));
            (
                ManifestFrom::Maker,
                theirs.id.unwrap_or_else(|| id_from(&repo.name)),
                theirs.name,
                theirs.description,
                theirs.maker.unwrap_or_else(|| repo.owner.login.clone()),
                asset.clone(),
                logo,
                theirs.manifest,
                theirs.add_copies,
                theirs.strip_top,
                false,
            )
        }
        None => {
            let asset = web_asset_of(&release.assets).ok_or_else(|| {
                    "There's no web build in its latest release: Misty looks for one .zip with \"web\" in its name, or a .war."
                        .to_owned()
                })?;
            let manifest = json!({
                "name": repo.name,
                "logo": "logo.png",
                "entry": "index.html",
                "own_origin": true,
                "shim": true,
                "permissions": ["files"],
            })
            .as_object()
            .cloned()
            .unwrap_or_default();
            (
                ManifestFrom::Basic,
                id_from(&repo.name),
                repo.name.clone(),
                repo.description.clone(),
                repo.owner.login.clone(),
                asset.clone(),
                picture,
                manifest,
                Vec::new(),
                false,
                true,
            )
        }
    };
    if !valid_id(&id) {
        return Err("The app's id isn't one Misty can use.".into());
    }
    let sha256 = sha256_of(&asset)
        .ok_or_else(|| format!("GitHub reports no checksum for {}.", asset.name))?;
    if !asset
        .browser_download_url
        .starts_with(&format!("https://github.com/{upstream}/releases/download/"))
    {
        return Err("Its web build isn't one of its own release's files.".into());
    }
    manifest.insert("license".into(), Value::String(license.clone()));
    let mut checked = manifest.clone();
    checked.insert("id".into(), Value::String(id.clone()));
    checked.insert("version".into(), Value::String(version.clone()));
    let parsed = AppManifest::parse(Value::Object(checked).to_string().as_bytes())?;
    let permissions = parsed
        .permissions
        .iter()
        .map(|permission| {
            serde_json::to_value(permission)
                .ok()
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default()
        })
        .collect();
    let entry = AppEntry {
        id,
        name,
        description,
        maker,
        upstream,
        license,
        version,
        tag: release.tag_name.clone(),
        url: asset.browser_download_url,
        sha256,
        size: asset.size,
        logo,
        permissions,
        manifest: Value::Object(manifest),
        add_copies,
        strip_top,
        auto_top,
        extra: serde_json::Map::new(),
    };
    Ok((entry, from))
}
