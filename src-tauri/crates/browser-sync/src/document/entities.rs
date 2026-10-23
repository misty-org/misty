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

/// A saved website sign-in. The origin is where it may be filled, never wider.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Login {
    /// `scheme://host[:port]`, as the sign-in page reported it.
    pub origin: String,
    pub username: String,
    pub password: String,
    /// Milliseconds since the Unix epoch.
    pub created_at: i64,
    pub updated_at: i64,
}

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

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Visit {
    pub url: String,
    pub title: String,
    /// Milliseconds since the Unix epoch.
    pub visited_at: i64,
    pub typed: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryBatch {
    /// The device that browsed.
    pub origin: String,
    /// Hours since the Unix epoch.
    pub hour: i64,
    pub part: u32,
    pub visits: Vec<Visit>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Window {
    pub title: String,
    pub order: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SplitTree {
    Leaf {
        id: String,
    },
    Split {
        id: String,
        direction: Direction,
        ratio: f64,
        first: Box<SplitTree>,
        second: Box<SplitTree>,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Horizontal,
    Vertical,
}

impl SplitTree {
    pub fn panes(&self) -> Result<BTreeSet<String>> {
        fn visit(
            node: &SplitTree,
            nodes: &mut BTreeSet<String>,
            panes: &mut BTreeSet<String>,
        ) -> Result<()> {
            let id = match node {
                SplitTree::Leaf { id } | SplitTree::Split { id, .. } => id,
            };
            if !valid_id(id) || !nodes.insert(id.clone()) || nodes.len() > 7 {
                return Err(Error::Invalid);
            }
            match node {
                SplitTree::Leaf { id } => {
                    panes.insert(id.clone());
                }
                SplitTree::Split {
                    ratio,
                    first,
                    second,
                    ..
                } => {
                    if !ratio.is_finite() || !(0.05..=0.95).contains(ratio) {
                        return Err(Error::Invalid);
                    }
                    visit(first, nodes, panes)?;
                    visit(second, nodes, panes)?;
                }
            }
            Ok(())
        }
        let mut panes = BTreeSet::new();
        visit(self, &mut BTreeSet::new(), &mut panes)?;
        if panes.len() > 4 {
            return Err(Error::Invalid);
        }
        Ok(panes)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tab {
    pub window_id: String,
    pub title: String,
    pub order: f64,
    pub tree: SplitTree,
    /// The page a pinned tab returns to; absent for unpinned tabs, so their
    /// records keep the shape older versions accept (see `PINNED_TAB_FIELDS`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_url: Option<String>,
}

/// Tab fields that versions before pinned tabs reject. They are only written
/// once every device understands them (control version 3); until then sync
/// drops them. A null value removes the field, so unpinning restores the old shape.
pub const PINNED_TAB_FIELDS: [&str; 1] = ["pinned_url"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Surface {
    Home,
    Browser,
    Files,
    Agents,
    Space,
    Extensions,
}

/// Moving a view is one field: concurrent moves cannot combine a tab from
/// one device with a pane/order from another.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Placement {
    #[serde(rename = "layout_id")]
    pub tab_id: String,
    pub pane_id: String,
    pub order: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct View {
    pub surface: Surface,
    pub title: String,
    pub placement: Placement,
    pub url: Option<String>,
    pub profile_id: Option<String>,
    #[serde(rename = "website_id")]
    pub bookmark_id: Option<String>,
    pub tool_route: Option<String>,
    pub agent_owned: bool,
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

mod validate;
pub use validate::validate;

#[cfg(test)]
mod bookmark_tree_tests {
    use super::*;

    fn fields(value: Value) -> Fields {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn folders_without_a_parent_keep_the_shape_older_versions_accept() {
        let flat = fields(serde_json::json!({
            "label": "Work", "icon": "folder", "order": 1.0, "hidden": false
        }));
        validate(Kind::Folder, &flat).unwrap();
        let folder: Folder = serde_json::from_value(serde_json::to_value(&flat).unwrap()).unwrap();
        let written = serde_json::to_value(folder).unwrap();
        assert!(written.get("parent_id").is_none() && written.get("added_at").is_none());
    }

    #[test]
    fn nested_folders_and_dates_validate() {
        let nested = fields(serde_json::json!({
            "label": "Clients", "icon": "folder", "order": 0.0, "hidden": false,
            "parent_id": "folder:work", "added_at": 1_700_000_000_000_i64
        }));
        validate(Kind::Folder, &nested).unwrap();
        let bad_parent = fields(serde_json::json!({
            "label": "Clients", "icon": "folder", "order": 0.0, "hidden": false,
            "parent_id": "folder/../x"
        }));
        assert!(validate(Kind::Folder, &bad_parent).is_err());
        let bad_date = fields(serde_json::json!({
            "group_id": "group:bookmarks", "title": "A", "url": "https://a.example/",
            "order": 0.0, "pinned": true, "added_at": -5
        }));
        assert!(validate(Kind::Bookmark, &bad_date).is_err());
    }
}
