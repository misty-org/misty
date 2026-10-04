// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: u64,
    pub guid: String,
    pub slug: String,
    pub name: String,
    pub summary: String,
    pub description: String,
    pub authors: Vec<String>,
    pub icon_url: String,
    pub version: String,
    pub users: u64,
    pub rating: f64,
    pub source_url: String,
    pub download_url: String,
    pub digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    pub entries: Vec<CatalogEntry>,
    pub count: u64,
    pub has_more: bool,
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Misty/0.1 (native WebKit extensions)")
        .timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !trusted_url(attempt.url()) {
                attempt.error("Extension download redirected outside Mozilla")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

pub fn trusted_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|p| p == 443)
        && matches!(
            url.host_str(),
            Some("addons.mozilla.org" | "addons.cdn.mozilla.net" | "addons.mozilla.net")
        )
}

pub async fn bytes(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let url = url::Url::parse(url).map_err(|_| "Invalid Mozilla URL")?;
    if !trusted_url(&url) {
        return Err("Extension resources must come from Mozilla.".into());
    }
    let mut response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("Extension resource is too large.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("Extension resource is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn localized(value: &Value) -> String {
    value
        .as_str()
        .or_else(|| value.get("en-US").and_then(Value::as_str))
        .or_else(|| {
            value
                .as_object()
                .and_then(|v| v.values().find_map(Value::as_str))
        })
        .unwrap_or_default()
        .to_owned()
}

fn entry(value: &Value) -> Result<CatalogEntry, String> {
    let file = &value["current_version"]["file"];
    if value["type"] != "extension" || value["is_disabled"] == true || file["status"] != "public" {
        return Err("This extension is not publicly available.".into());
    }
    let string = |v: &Value| v.as_str().unwrap_or_default().to_owned();
    let entry = CatalogEntry {
        id: value["id"]
            .as_u64()
            .ok_or("Mozilla returned an invalid extension ID.")?,
        guid: string(&value["guid"]),
        slug: string(&value["slug"]),
        name: localized(&value["name"]),
        summary: localized(&value["summary"]),
        description: localized(&value["description"]),
        authors: value["authors"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|a| a["name"].as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
        icon_url: string(&value["icon_url"]),
        version: string(&value["current_version"]["version"]),
        users: value["average_daily_users"].as_u64().unwrap_or(0),
        rating: value["ratings"]["average"].as_f64().unwrap_or(0.0),
        source_url: string(&value["url"]),
        download_url: string(&file["url"]),
        digest: string(&file["hash"]),
    };
    if entry.guid.is_empty() || entry.download_url.is_empty() {
        return Err("Mozilla returned incomplete package metadata.".into());
    }
    Ok(entry)
}

pub async fn detail(id: u64) -> Result<CatalogEntry, String> {
    let data = bytes(
        &format!("https://addons.mozilla.org/api/v5/addons/addon/{id}/"),
        2 * 1024 * 1024,
    )
    .await?;
    entry(&serde_json::from_slice(&data).map_err(|_| "Mozilla returned invalid JSON.")?)
}

pub async fn search(
    query: String,
    category: Option<String>,
    page: u32,
    sort: String,
) -> Result<CatalogPage, String> {
    let mut url = url::Url::parse("https://addons.mozilla.org/api/v5/addons/search/").unwrap();
    let sort = match sort.as_str() {
        "updated" => "updated",
        "ratings" => "ratings",
        "users" => "users",
        _ if !query.trim().is_empty() => "relevance",
        _ => "recommended,users",
    };
    url.query_pairs_mut()
        .append_pair("app", "firefox")
        .append_pair("type", "extension")
        .append_pair("q", &query.chars().take(100).collect::<String>())
        .append_pair("page", &page.clamp(1, 1000).to_string())
        .append_pair("page_size", "25")
        .append_pair("sort", sort);
    if let Some(category) = category.filter(|s| s.len() < 80) {
        url.query_pairs_mut().append_pair("category", &category);
    }
    let data = bytes(url.as_str(), 8 * 1024 * 1024).await?;
    let value: Value =
        serde_json::from_slice(&data).map_err(|_| "Mozilla returned invalid JSON.")?;
    Ok(CatalogPage {
        entries: value["results"]
            .as_array()
            .ok_or("Mozilla returned no results.")?
            .iter()
            .filter_map(|v| entry(v).ok())
            .collect(),
        count: value["count"].as_u64().unwrap_or(0),
        has_more: value["next"].is_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_mozilla_resource_origins() {
        for value in [
            "https://addons.mozilla.org/file.xpi",
            "https://addons.cdn.mozilla.net/x",
        ] {
            assert!(trusted_url(&url::Url::parse(value).unwrap()));
        }
        for value in [
            "http://addons.mozilla.org/x",
            "https://addons.mozilla.org.evil.test/x",
            "https://user@addons.mozilla.org/x",
            "https://addons.mozilla.org:8443/x",
        ] {
            assert!(!trusted_url(&url::Url::parse(value).unwrap()));
        }
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Downloads current public Mozilla packages; run explicitly for compatibility intake"]
    async fn mozilla_package_intake() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        for query in ["Dark Reader", "Bitwarden", "SingleFile", "ClearURLs"] {
            let page = search(query.into(), None, 1, "relevance".into())
                .await
                .unwrap();
            let item = page
                .entries
                .first()
                .expect("Mozilla should return a public extension");
            let detail = detail(item.id).await.unwrap();
            let bytes = bytes(&detail.download_url, 64 * 1024 * 1024).await.unwrap();
            let root = tempfile::tempdir().unwrap();
            let review =
                super::super::package::extract(&bytes, detail, root.path(), "intake".into())
                    .unwrap();
            println!("{} {}: integrity/identity verified; {} required APIs, {} site patterns; blocked={}; runtime compatibility remains unverified",review.entry.name,review.entry.version,review.permissions.len(),review.hosts.len(),review.blocked);
        }
    }
}

#[derive(Serialize)]
pub struct Category {
    pub id: String,
    pub name: String,
}
pub async fn categories() -> Result<Vec<Category>, String> {
    let bytes = bytes(
        "https://addons.mozilla.org/api/v5/addons/categories/?app=firefox&type=extension",
        1024 * 1024,
    )
    .await?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Mozilla returned invalid categories.")?;
    Ok(value
        .as_array()
        .ok_or("Mozilla returned invalid categories.")?
        .iter()
        .filter(|v| v["type"] == "extension")
        .filter_map(|v| {
            Some(Category {
                id: v["slug"].as_str()?.to_owned(),
                name: localized(&v["name"]).replace('&', "and"),
            })
        })
        .collect())
}
