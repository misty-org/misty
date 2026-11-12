//! Records kept in a profile's collections: Space settings, extensions,
//! site permissions, search and downloads.
use super::*;

/// The sites a Space claims, as hosts (`mail.example.com`); subdomains match too.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpaceSites {
    pub hosts: Vec<String>,
}

/// The most hosts one Space may claim.
pub const MAX_SPACE_SITES: usize = 200;

/// A lowercase DNS host without a scheme, port or path.
pub fn site_host(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 253
        && !value.starts_with('.')
        && !value.ends_with('.')
        && !value.contains("..")
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'))
}

/// A web origin exactly as `Url::origin` serializes it, http or https only.
pub fn login_origin(value: &str) -> Result<()> {
    let url = url::Url::parse(value).map_err(|_| Error::Invalid)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.origin().ascii_serialization() != value
        || value.len() > 512
    {
        return Err(Error::Invalid);
    }
    Ok(())
}

/// An extension installed in a Space. Packages come from the store on each
/// device; only the identity, version and on/off travel.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Extension {
    /// The store's id: a Chrome Web Store id or an addons.mozilla.org number.
    pub store_id: String,
    pub name: String,
    /// The version last installed; empty while the first install runs.
    pub version: String,
    pub enabled: bool,
    /// Milliseconds since the Unix epoch.
    pub updated_at: i64,
}

/// One answer to a site's request: as the Space's site settings name it.
#[derive(Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SiteDecision {
    #[default]
    Ask,
    Allow,
    Block,
}

impl SiteDecision {
    pub fn is_ask(&self) -> bool {
        *self == Self::Ask
    }
}

/// A site's permission choices in a Space. A site with every choice at Ask
/// has no record.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SitePermission {
    /// `scheme://host[:port]`, as `Url::origin` writes it.
    pub origin: String,
    pub camera: SiteDecision,
    pub microphone: SiteDecision,
    #[serde(default)]
    pub notifications: SiteDecision,
    #[serde(default)]
    pub popups: SiteDecision,
    /// Left out while Ask, so devices from before location still read the record.
    #[serde(default, skip_serializing_if = "SiteDecision::is_ask")]
    pub location: SiteDecision,
    pub updated_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchDefault {
    /// A built-in engine's id, or the record id of a `SearchEngine`.
    pub engine: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchEngine {
    pub name: String,
    /// `%s` is replaced with the query.
    pub search: String,
    pub order: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchBang {
    /// Typed as `!trigger`; lowercase letters, digits, dots and dashes.
    pub trigger: String,
    pub name: String,
    /// `%s` is replaced with the query.
    pub url: String,
    pub order: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Download {
    pub url: String,
    pub file_name: String,
    /// Bytes; absent when unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// Milliseconds since the Unix epoch.
    pub finished_at: i64,
    /// The device that holds the file.
    pub device_id: String,
}
