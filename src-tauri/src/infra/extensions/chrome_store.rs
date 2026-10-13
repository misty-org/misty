// SPDX-License-Identifier: MIT
//! The Chrome Web Store's update service: an extension's current package,
//! asked for the way Chromium's extension updater asks. Its answer carries
//! the package's address, version and SHA-256; `crx.rs` then checks the
//! store's signature before anything unpacks.
use super::catalog::{self, CatalogEntry, Store, REMOVED};
use base64::Engine;
use serde_json::Value;
use std::path::Path;

/// The Chrome version Misty reports. The store withholds packages that need
/// a newer Chrome, so this tracks a current stable release.
const PRODUCT_VERSION: &str = "141.0.0.0";

pub async fn latest(id: &str) -> Result<CatalogEntry, String> {
    let mut url = url::Url::parse("https://clients2.google.com/service/update2/crx").unwrap();
    url.query_pairs_mut()
        .append_pair("response", "updatecheck")
        .append_pair("acceptformat", "crx3")
        .append_pair("prodversion", PRODUCT_VERSION)
        .append_pair("x", &format!("id={id}&uc"));
    let response = catalog::bytes(url.as_str(), 256 * 1024).await?;
    parse(
        id,
        std::str::from_utf8(&response).map_err(|_| unavailable())?,
    )
}

fn unavailable() -> String {
    "The Chrome Web Store could not provide this extension.".into()
}

fn parse(id: &str, xml: &str) -> Result<CatalogEntry, String> {
    let app = element(xml, "app").ok_or_else(unavailable)?;
    if attribute(app, "appid").as_deref() != Some(id) {
        return Err(unavailable());
    }
    match attribute(app, "status").as_deref() {
        Some("ok") => {}
        Some("error-unknownApplication") => return Err(REMOVED.into()),
        _ => return Err(unavailable()),
    }
    let check = element(xml, "updatecheck").ok_or_else(unavailable)?;
    match attribute(check, "status").as_deref() {
        Some("ok") => {}
        Some("noupdate") => {
            return Err(
                "This extension needs a newer version of Chrome than Misty supports.".into(),
            )
        }
        _ => return Err(unavailable()),
    }
    let codebase = attribute(check, "codebase").ok_or_else(unavailable)?;
    let version = attribute(check, "version")
        .filter(|v| !v.is_empty() && v.len() <= 64)
        .ok_or_else(unavailable)?;
    let hash = attribute(check, "hash_sha256")
        .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(unavailable)?;
    if !url::Url::parse(&codebase).is_ok_and(|url| catalog::trusted_url(&url)) {
        return Err(unavailable());
    }
    Ok(CatalogEntry {
        id: id.to_owned(),
        store: Store::Chrome,
        guid: id.to_owned(),
        slug: String::new(),
        // The package's own manifest names it; see `describe`.
        name: String::new(),
        summary: String::new(),
        description: String::new(),
        authors: Vec::new(),
        icon_url: String::new(),
        version,
        users: 0,
        rating: 0.0,
        source_url: format!("https://chromewebstore.google.com/detail/{id}"),
        download_url: codebase,
        digest: format!("sha256:{}", hash.to_ascii_lowercase()),
    })
}

/// The start tag `<name …>`, without its angle brackets.
fn element<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}");
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after = &rest[start + open.len()..];
        if after.starts_with(|c: char| c.is_ascii_whitespace() || c == '>' || c == '/') {
            return after.find('>').map(|end| &after[..end]);
        }
        rest = after;
    }
    None
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let mut rest = tag;
    while let Some(start) = rest.find(&needle) {
        let preceded = rest[..start].ends_with(|c: char| c.is_ascii_whitespace());
        let value = &rest[start + needle.len()..];
        let end = value.find('"')?;
        if preceded {
            return Some(
                value[..end]
                    .replace("&quot;", "\"")
                    .replace("&apos;", "'")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&amp;", "&"),
            );
        }
        rest = &value[end..];
    }
    None
}

/// Chrome packages describe themselves: name, description, author and icon
/// come from the verified manifest rather than the store's web page.
pub fn describe(entry: &mut CatalogEntry, manifest: &Value, runtime: &Path) {
    let text = |value: &Value| message(runtime, manifest, value.as_str().unwrap_or_default());
    entry.name = text(&manifest["name"]).chars().take(200).collect();
    entry.summary = text(&manifest["description"]).chars().take(1000).collect();
    entry.authors = match &manifest["author"] {
        Value::String(author) => vec![author.clone()],
        Value::Object(author) => author
            .get("email")
            .and_then(Value::as_str)
            .map(|v| vec![v.to_owned()])
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    entry.icon_url = icon(runtime, manifest).unwrap_or_default();
}

/// Resolves a `__MSG_name__` placeholder from the package's default locale.
fn message(runtime: &Path, manifest: &Value, value: &str) -> String {
    let Some(key) = value
        .strip_prefix("__MSG_")
        .and_then(|v| v.strip_suffix("__"))
    else {
        return value.to_owned();
    };
    let mut locales = vec!["en_US", "en"];
    if let Some(default) = manifest["default_locale"].as_str() {
        locales.insert(0, default);
    }
    for locale in locales {
        if locale.is_empty()
            || !locale
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            continue;
        }
        let path = runtime.join("_locales").join(locale).join("messages.json");
        let Some(messages) = std::fs::metadata(&path)
            .ok()
            .filter(|m| m.is_file() && m.len() <= 4 * 1024 * 1024)
            .and_then(|_| std::fs::read(&path).ok())
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        else {
            continue;
        };
        let found = messages.as_object().and_then(|messages| {
            messages
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(key))
                .and_then(|(_, entry)| entry["message"].as_str())
        });
        if let Some(found) = found {
            return found.to_owned();
        }
    }
    value.to_owned()
}

/// The package's PNG icon closest to 128 px, as a data URL.
fn icon(runtime: &Path, manifest: &Value) -> Option<String> {
    let icons = manifest["icons"].as_object()?;
    let mut sizes: Vec<(u32, &str)> = icons
        .iter()
        .filter_map(|(size, path)| Some((size.parse().ok()?, path.as_str()?)))
        .collect();
    sizes.sort_by_key(|(size, _)| (*size > 128, size.abs_diff(128)));
    let (_, relative) = sizes.first()?;
    let relative = Path::new(relative.trim_start_matches('/'));
    if relative
        .components()
        .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return None;
    }
    let path = runtime.join(relative);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > 512 * 1024 {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    bytes.starts_with(b"\x89PNG\r\n\x1a\n").then(|| {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESPONSE: &str = r#"<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0" server="prod"><daystart elapsed_days="7224"/><app appid="ddkjiahejlhfcafbddmgiahcphecmpfh" cohort="1::" status="ok"><updatecheck codebase="https://clients2.googleusercontent.com/crx/blobs/A/X.crx?a=1&amp;b=2" fp="1.6e" hash_sha256="6ee81f9e71a1fa1d1bd6fdfc41f14cfa739bdb68e6ee137bf529907aafdd7308" protected="0" size="9672935" status="ok" version="2026.1006.1931"/></app></gupdate>"#;

    #[test]
    fn reads_the_package_the_update_service_offers() {
        let entry = parse("ddkjiahejlhfcafbddmgiahcphecmpfh", RESPONSE).unwrap();
        assert_eq!(entry.store, Store::Chrome);
        assert_eq!(entry.guid, entry.id);
        assert_eq!(entry.version, "2026.1006.1931");
        assert_eq!(
            entry.download_url,
            "https://clients2.googleusercontent.com/crx/blobs/A/X.crx?a=1&b=2"
        );
        assert!(entry.digest.starts_with("sha256:6ee81f9e"));
    }

    #[test]
    fn refuses_other_ids_removed_extensions_and_foreign_hosts() {
        assert!(parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", RESPONSE).is_err());
        let removed = r#"<gupdate><app appid="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" status="error-unknownApplication"/></gupdate>"#;
        assert_eq!(
            parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", removed).unwrap_err(),
            REMOVED
        );
        let foreign = RESPONSE.replace("clients2.googleusercontent.com", "example.com");
        assert!(parse("ddkjiahejlhfcafbddmgiahcphecmpfh", &foreign).is_err());
        let incompatible =
            RESPONSE.replace(r#"status="ok" version"#, r#"status="noupdate" version"#);
        assert!(parse("ddkjiahejlhfcafbddmgiahcphecmpfh", &incompatible)
            .unwrap_err()
            .contains("newer version of Chrome"));
    }

    #[test]
    fn describes_packages_from_their_manifest_and_default_locale() {
        let root = tempfile::tempdir().unwrap();
        let locale = root.path().join("_locales/fr");
        std::fs::create_dir_all(&locale).unwrap();
        std::fs::write(
            locale.join("messages.json"),
            r#"{"ExtName":{"message":"Bloqueur"},"desc":{"message":"Bloque"}}"#,
        )
        .unwrap();
        std::fs::write(root.path().join("icon.png"), b"\x89PNG\r\n\x1a\nimage").unwrap();
        let manifest = serde_json::json!({"name":"__MSG_extName__","description":"__MSG_desc__","default_locale":"fr","author":"Someone","icons":{"16":"icon16.png","128":"icon.png"}});
        let mut entry = parse("ddkjiahejlhfcafbddmgiahcphecmpfh", RESPONSE).unwrap();
        describe(&mut entry, &manifest, root.path());
        assert_eq!(entry.name, "Bloqueur");
        assert_eq!(entry.summary, "Bloque");
        assert_eq!(entry.authors, vec!["Someone"]);
        assert!(entry.icon_url.starts_with("data:image/png;base64,"));
    }
}
