use base64::Engine as _;
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, Result};

pub type Fields = BTreeMap<String, Value>;

/// Record kinds. Serialized names are the stored ones (`group`, `website`,
/// `layout`, `tab`): they are inside encrypted records and hashed into node
/// IDs, so they never change. Record fields renamed in code keep their stored
/// names the same way.
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    #[serde(rename = "group")]
    Folder,
    #[serde(rename = "website")]
    Bookmark,
    Window,
    #[serde(rename = "layout")]
    Tab,
    #[serde(rename = "tab")]
    View,
    /// An open tab group in a workspace: name, color and the tabs in it.
    /// Written only once every device understands it (see `SyncState::all_upgraded`).
    TabGroup,
    /// A closed tab group kept to reopen on any device (`tab_groups` collection).
    SavedTabGroup,
    /// One device's browsing history for one hour, or one part of it
    /// (`history` collection).
    HistoryBatch,
    /// A single extension storage.sync key in a private encrypted collection.
    ExtensionSyncKey,
    /// Durable account removal; old offline writes cannot restore this generation.
    ExtensionRemoval,
    /// A saved website sign-in (`passwords` collection). Native-only: sealed with
    /// the vault key and never projected to a renderer.
    Login,
    /// The sites a Space claims: links to them from other apps open in its
    /// window (`space_settings` collection). Native-only.
    SpaceSites,
    /// An extension installed in the Space (`extensions` collection). Native-only.
    Extension,
    /// One site's permission choices in the Space (`site_permissions`
    /// collection). Native-only.
    SitePermission,
    /// The Space's default search engine (`search` collection, one record).
    SearchDefault,
    /// A search engine the person added (`search` collection).
    SearchEngine,
    /// A `!trigger` search shortcut the person added (`search` collection).
    SearchBang,
    /// A finished download (`downloads` collection); the file stays on the
    /// device that downloaded it.
    Download,
}

impl Kind {
    pub fn key(self, id: &str) -> Result<String> {
        if !valid_id(id) || id.starts_with("recovery:") {
            return Err(Error::Invalid);
        }
        // Stored key prefixes; see `Kind`.
        let kind = match self {
            Self::Folder => "group",
            Self::Bookmark => "website",
            Self::Window => "window",
            Self::Tab => "layout",
            Self::View => "tab",
            Self::TabGroup => "tab_group",
            Self::SavedTabGroup => "saved_tab_group",
            Self::HistoryBatch => "history_batch",
            Self::ExtensionSyncKey => "extension_sync_key",
            Self::ExtensionRemoval => "extension_removal",
            Self::Login => "login",
            Self::SpaceSites => "space_sites",
            Self::Extension => "extension",
            Self::SitePermission => "site_permission",
            Self::SearchDefault => "search_default",
            Self::SearchEngine => "search_engine",
            Self::SearchBang => "search_bang",
            Self::Download => "download",
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Folder {
    pub label: String,
    pub icon: String,
    pub order: f64,
    pub hidden: bool,
    /// The folder this one sits in. Absent for the roots and for folders
    /// directly in Other bookmarks, so records without nesting keep the shape
    /// older versions accept (see `NESTED_BOOKMARK_FIELDS`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// When the folder was first added, in ms since the epoch (kept from imports).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_at: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bookmark {
    #[serde(rename = "group_id")]
    pub folder_id: String,
    pub title: String,
    pub url: String,
    pub order: f64,
    pub pinned: bool,
    /// When the bookmark was first added, in ms since the epoch (kept from imports).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_at: Option<i64>,
}

/// Bookmark tree fields. Versions before nested folders reject records that
/// carry them, so they are only written once every device understands them
/// (control version 2); until then sync drops them and folders stay flat.
pub const NESTED_BOOKMARK_FIELDS: [&str; 2] = ["parent_id", "added_at"];
/// Folders nest at most this deep below a root.
pub const MAX_FOLDER_DEPTH: usize = 64;

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

// Uploaded icons are bounded static PNGs; ordinary icon names keep their old limit.
fn group_icon(value: &str) -> Result<()> {
    if let Some(encoded) = value.strip_prefix("data:image/png;base64,") {
        if value.len() > 32_768 {
            return Err(Error::TooLarge);
        }
        let png = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| Error::Invalid)?;
        if png.len() < 24 || &png[..8] != b"\x89PNG\r\n\x1a\n" || &png[12..16] != b"IHDR" {
            return Err(Error::Invalid);
        }
        let width = u32::from_be_bytes(png[16..20].try_into().map_err(|_| Error::Invalid)?);
        let height = u32::from_be_bytes(png[20..24].try_into().map_err(|_| Error::Invalid)?);
        if !(1..=64).contains(&width) || !(1..=64).contains(&height) {
            return Err(Error::Invalid);
        }
        Ok(())
    } else {
        text(value, 48, false)?;
        if !valid_id(value) {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

mod collections;
mod layout;
mod validate;
pub use collections::{
    login_origin, site_host, Download, Extension, HistoryBatch, Login, SearchBang, SearchDefault,
    SearchEngine, SiteDecision, SitePermission, SpaceSites, Visit, MAX_SPACE_SITES,
};
pub use layout::{Direction, Placement, SplitTree, Surface, Tab, View, Window, PINNED_TAB_FIELDS};
pub use validate::validate;

#[cfg(test)]
mod bookmark_tree_tests;
