use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, Result};

pub type Fields = BTreeMap<String, Value>;

/// Record kinds. Serialized names are the stored ones (`group`, `website`,
/// `layout`, `tab`): they are inside encrypted records, so they never change.
/// Record fields renamed in code keep their stored names the same way.
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Window,
    #[serde(rename = "layout")]
    Tab,
    #[serde(rename = "tab")]
    View,
    /// An open tab group: name, color and the tabs in it.
    TabGroup,
    /// A closed tab group kept to reopen on any computer (`tab_groups` collection).
    SavedTabGroup,
    /// The sites a profile claims: links to them from other apps open in its
    /// window. Native-only.
    SpaceSites,
    /// An extension installed in the profile (`extensions` collection). Native-only.
    Extension,
    /// One site's permission choices in the profile (`site_permissions`
    /// collection). Native-only.
    SitePermission,
    /// The profile's default search engine (`search` collection, one record).
    SearchDefault,
    /// A search engine the person added (`search` collection).
    SearchEngine,
    /// A `!trigger` search shortcut the person added (`search` collection).
    SearchBang,
    /// A finished download (`downloads` collection); the file stays on the
    /// computer that downloaded it.
    Download,
    /// One tab strip entry of a profile, with its splits and views. Its fields belong to the
    /// renderer, which has to read them back: anything it adds later is kept as it is.
    OpenTab,
}

impl Kind {
    pub fn key(self, id: &str) -> Result<String> {
        if !valid_id(id) || id.starts_with("recovery:") {
            return Err(Error::Invalid);
        }
        // Stored key prefixes; see `Kind`.
        let kind = match self {
            Self::Window => "window",
            Self::Tab => "layout",
            Self::View => "tab",
            Self::TabGroup => "tab_group",
            Self::SavedTabGroup => "saved_tab_group",
            Self::SpaceSites => "space_sites",
            Self::Extension => "extension",
            Self::SitePermission => "site_permission",
            Self::SearchDefault => "search_default",
            Self::SearchEngine => "search_engine",
            Self::SearchBang => "search_bang",
            Self::Download => "download",
            Self::OpenTab => "open_tab",
        };
        Ok(format!("{kind}/{id}"))
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'-' | b'_' | b'.'))
}

fn text(value: &str, limit: usize, empty: bool) -> Result<()> {
    if value.len() > limit || (!empty && value.trim().is_empty()) || value.contains('\0') {
        return Err(Error::Invalid);
    }
    Ok(())
}

pub fn web_url(value: &str) -> Result<()> {
    if value.len() > 16_384 {
        return Err(Error::TooLarge);
    }
    let url = url::Url::parse(value).map_err(|_| Error::Invalid)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::Invalid);
    }
    Ok(())
}

fn order(value: f64) -> Result<()> {
    if !value.is_finite() || value.abs() > 1e15 {
        return Err(Error::Invalid);
    }
    Ok(())
}

fn added_at(value: Option<i64>) -> Result<()> {
    if value.is_some_and(|at| !(0..=10_000_000_000_000).contains(&at)) {
        return Err(Error::Invalid);
    }
    Ok(())
}

/// Tab group colors, as named by the renderer.
const TAB_GROUP_COLORS: &[&str] = &[
    "gray", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TabGroup {
    pub name: String,
    pub color: String,
    pub order: f64,
    /// Tabs in the group, in tab-strip order.
    #[serde(rename = "layout_ids")]
    pub tab_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedTabGroup {
    pub name: String,
    pub color: String,
    pub order: f64,
    /// The group's saved tabs as the renderer stores them (JSON text).
    #[serde(rename = "layouts")]
    pub tabs: String,
}

/// A search address with `%s` where the query goes.
fn search_template(value: &str) -> Result<()> {
    if !value.contains("%s") {
        return Err(Error::Invalid);
    }
    web_url(&value.replace("%s", "query"))
}

fn bang_trigger(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=24).contains(&bytes.len())
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'))
}

pub fn profile_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

mod collections;
mod layout;
mod validate;
pub use collections::{
    login_origin, site_host, Download, Extension, SearchBang, SearchDefault, SearchEngine,
    SiteDecision, SitePermission, SpaceSites, MAX_SPACE_SITES,
};
pub use layout::{Direction, Placement, SplitTree, Surface, Tab, View, Window};
pub use validate::validate;
