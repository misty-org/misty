use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::manifest::{valid_id, valid_version, AppManifest};

/// The licenses an app may carry, as GitHub names them (SPDX). All are approved by the Open Source Initiative;
/// source-available licenses (BUSL, SSPL, Elastic, Commons Clause) aren't among them.
const OPEN_SOURCE_LICENSES: &[&str] = &[
    "0BSD",
    "AFL-3.0",
    "AGPL-3.0",
    "Apache-2.0",
    "Artistic-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSD-3-Clause-Clear",
    "BSL-1.0",
    "ECL-2.0",
    "EPL-1.0",
    "EPL-2.0",
    "EUPL-1.1",
    "EUPL-1.2",
    "GPL-2.0",
    "GPL-3.0",
    "ISC",
    "LGPL-2.1",
    "LGPL-3.0",
    "LPPL-1.3c",
    "MIT",
    "MIT-0",
    "MPL-2.0",
    "MS-PL",
    "MS-RL",
    "MulanPSL-2.0",
    "NCSA",
    "OFL-1.1",
    "OSL-3.0",
    "PostgreSQL",
    "UPL-1.0",
    "Unlicense",
    "Zlib",
];

const MAX_REPO_MANIFEST_BYTES: usize = 64 << 10;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub maker: String,
    pub upstream: String,
    pub license: String,
    pub version: String,
    pub tag: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub logo: String,
    pub permissions: Vec<String>,
    pub manifest: Value,
    #[serde(default)]
    pub add_copies: Vec<Value>,
    #[serde(default)]
    pub strip_top: bool,
    #[serde(default)]
    pub auto_top: bool,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManifestFrom {
    Reviewed,
    Maker,
    Basic,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "result", rename_all = "lowercase")]
pub enum Resolved {
    App { repo: String, listed: bool, manifest_from: ManifestFrom, entry: AppEntry },
    Incompatible { repo: String, reason: String },
}

#[derive(Debug, Clone, Deserialize)]
struct RepoManifest {
    #[serde(default)]
    id: Option<String>,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    maker: Option<String>,
    web_asset: String,
    #[serde(default)]
    icon: Option<String>,
    manifest: serde_json::Map<String, Value>,
    #[serde(default)]
    add_copies: Vec<Value>,
    #[serde(default)]
    strip_top: bool,
}

#[derive(Debug, Deserialize)]
struct Catalog {
    apps: Vec<AppEntry>,
}

#[derive(Debug, Deserialize)]
struct Repo {
    name: String,
    owner: Owner,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    license: Option<RepoLicense>,
    #[serde(default)]
    archived: bool,
}

#[derive(Debug, Deserialize)]
struct Owner {
    login: String,
    #[serde(default)]
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RepoLicense {
    #[serde(default)]
    spdx_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Debug, Clone, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    #[serde(default)]
    digest: Option<String>,
}

pub fn repo_of(link: &str) -> Option<(String, String)> {
    let trimmed = link.trim().trim_end_matches('/');
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let rest = rest.strip_prefix("www.").unwrap_or(rest);
    let path = match rest.strip_prefix("github.com/") {
        Some(path) => path,
        None if !rest.contains('.') || rest.matches('/').count() == 1 => rest,
        None => return None,
    };
    let mut parts = path.split('/');
    let owner = parts.next()?.to_owned();
    let name = parts.next()?.trim_end_matches(".git").to_owned();
    let part_ok = |part: &str| {
        !part.is_empty()
            && part.len() <= 100
            && part != "."
            && part != ".."
            && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    };
    (part_ok(&owner) && part_ok(&name)).then_some((owner, name))
}

fn reviewed_in(catalog: &str, repo: &str) -> Result<Option<AppEntry>, String> {
    let catalog: Catalog =
        serde_json::from_str(catalog).map_err(|error| format!("Misty's app catalog isn't valid: {error}"))?;
    Ok(catalog.apps.into_iter().find(|app| app.upstream.eq_ignore_ascii_case(repo)))
}

fn id_from(name: &str) -> String {
    let mut id: String = name
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    while id.contains("--") {
        id = id.replace("--", "-");
    }
    let mut id = id.trim_matches('-').to_owned();
    if !id.starts_with(|c: char| c.is_ascii_lowercase()) {
        id = format!("app-{id}");
    }
    id.truncate(63);
    let id = id.trim_end_matches('-').to_owned();
    if id.len() < 2 { "app".to_owned() } else { id }
}

fn version_of(tag: &str) -> String {
    tag.strip_prefix('v').unwrap_or(tag).to_owned()
}

fn web_asset_of(assets: &[Asset]) -> Option<&Asset> {
    let mut web = assets.iter().filter(|asset| {
        let name = asset.name.to_ascii_lowercase();
        name.ends_with(".zip") && name.contains("web")
    });
    let first = web.next()?;
    web.next().is_none().then_some(first)
}

fn sha256_of(asset: &Asset) -> Option<String> {
    let digest = asset.digest.as_deref()?.strip_prefix("sha256:")?;
    (digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())).then(|| digest.to_ascii_lowercase())
}

fn open_source(spdx: Option<&str>) -> Option<String> {
    let spdx = spdx?;
    OPEN_SOURCE_LICENSES.iter().any(|known| known.eq_ignore_ascii_case(spdx)).then(|| spdx.to_owned())
}

fn entry_from(
    repo: &Repo,
    release: &Release,
    maker_manifest: Option<RepoManifest>,
) -> Result<(AppEntry, ManifestFrom), String> {
    let upstream = format!("{}/{}", repo.owner.login, repo.name);
    let license = open_source(repo.license.as_ref().and_then(|license| license.spdx_id.as_deref())).ok_or_else(|| {
        "Its license isn't an open-source one GitHub recognizes, so Misty can't add it.".to_owned()
    })?;
    if release.draft || release.prerelease {
        return Err("Its latest release is a draft or a pre-release.".into());
    }
    let version = version_of(&release.tag_name);
    if !valid_version(&version) {
        return Err("Its latest release's tag isn't a version Misty can name a folder after.".into());
    }
    let raw = format!("https://raw.githubusercontent.com/{upstream}/{}", release.tag_name);
    let picture = repo.owner.avatar_url.clone().unwrap_or_else(|| format!("https://github.com/{}.png", repo.owner.login));
    let (from, id, name, description, maker, asset, logo, mut manifest, add_copies, strip_top, auto_top) =
        match maker_manifest {
            Some(theirs) => {
                let file = theirs.web_asset.replace("{version}", &version);
                let asset = release
                    .assets
                    .iter()
                    .find(|asset| asset.name == file)
                    .ok_or_else(|| format!("Its latest release has no {file}, which its misty-app.json names."))?;
                let logo = theirs.icon.as_deref().map_or(picture, |icon| format!("{raw}/{icon}"));
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
                    "There's no web build in its latest release: Misty looks for one .zip with \"web\" in its name."
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
    let sha256 = sha256_of(&asset).ok_or_else(|| format!("GitHub reports no checksum for {}.", asset.name))?;
    if !asset.browser_download_url.starts_with(&format!("https://github.com/{upstream}/releases/download/")) {
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
            serde_json::to_value(permission).ok().and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_default()
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

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Misty")
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

async fn get_json<T: serde::de::DeserializeOwned>(client: &reqwest::Client, url: &str) -> Result<Option<T>, String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "Misty couldn't reach GitHub. Check your connection and try again.".to_owned())?;
    match response.status().as_u16() {
        404 => Ok(None),
        403 | 429 => Err("GitHub is limiting how often Misty asks. Try again in a few minutes.".into()),
        status if !(200..300).contains(&status) => Err(format!("GitHub answered {status}. Try again later.")),
        _ => response
            .json::<T>()
            .await
            .map(Some)
            .map_err(|_| "GitHub's answer wasn't what Misty expected.".to_owned()),
    }
}

async fn maker_manifest(client: &reqwest::Client, upstream: &str) -> Result<Option<RepoManifest>, String> {
    let url = format!("https://raw.githubusercontent.com/{upstream}/HEAD/misty-app.json");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|_| "Misty couldn't reach GitHub. Check your connection and try again.".to_owned())?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("GitHub answered {} for its misty-app.json. Try again later.", response.status().as_u16()));
    }
    let bytes = response.bytes().await.map_err(|_| "Misty couldn't read its misty-app.json.".to_owned())?;
    if bytes.len() > MAX_REPO_MANIFEST_BYTES {
        return Err("Its misty-app.json is too large.".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("Its misty-app.json isn't valid: {error}"))
}

pub async fn resolve(link: &str) -> Result<Resolved, String> {
    let (owner, name) = repo_of(link).ok_or_else(|| "That isn't a link to a GitHub repository.".to_owned())?;
    let asked = format!("{owner}/{name}");
    let listed_apps = crate::registry::current().apps_json();
    if let Some(entry) = reviewed_in(&listed_apps, &asked)? {
        return Ok(Resolved::App { repo: entry.upstream.clone(), listed: true, manifest_from: ManifestFrom::Reviewed, entry });
    }
    let client = client()?;
    let Some(repo) = get_json::<Repo>(&client, &format!("https://api.github.com/repos/{asked}")).await? else {
        return Ok(Resolved::Incompatible { repo: asked, reason: "There's no public repository at that link.".into() });
    };
    let upstream = format!("{}/{}", repo.owner.login, repo.name);
    if let Some(entry) = reviewed_in(&listed_apps, &upstream)? {
        return Ok(Resolved::App { repo: upstream, listed: true, manifest_from: ManifestFrom::Reviewed, entry });
    }
    if repo.archived {
        return Ok(Resolved::Incompatible { repo: upstream, reason: "The repository is archived.".into() });
    }
    let theirs = match maker_manifest(&client, &upstream).await {
        Ok(found) => found,
        Err(reason) => return Ok(Resolved::Incompatible { repo: upstream, reason }),
    };
    let Some(release) =
        get_json::<Release>(&client, &format!("https://api.github.com/repos/{upstream}/releases/latest")).await?
    else {
        return Ok(Resolved::Incompatible { repo: upstream, reason: "It has no release to add.".into() });
    };
    Ok(match entry_from(&repo, &release, theirs) {
        Ok((entry, manifest_from)) => Resolved::App { repo: upstream, listed: false, manifest_from, entry },
        Err(reason) => Resolved::Incompatible { repo: upstream, reason },
    })
}

#[cfg(test)]
mod tests;
