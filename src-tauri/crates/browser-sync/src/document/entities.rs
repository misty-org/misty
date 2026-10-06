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
}

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

pub fn validate(kind: Kind, fields: &Fields) -> Result<()> {
    let value = serde_json::to_value(fields)?;
    match kind {
        Kind::Folder => {
            let v: Folder = serde_json::from_value(value)?;
            text(&v.label, 160, false)?;
            group_icon(&v.icon)?;
            order(v.order)?;
            if v.parent_id.as_deref().is_some_and(|id| !valid_id(id)) {
                return Err(Error::Invalid);
            }
            added_at(v.added_at)?;
        }
        Kind::Bookmark => {
            let v: Bookmark = serde_json::from_value(value)?;
            if !valid_id(&v.folder_id) {
                return Err(Error::Invalid);
            }
            text(&v.title, 512, false)?;
            web_url(&v.url)?;
            order(v.order)?;
            added_at(v.added_at)?;
        }
        Kind::Window => {
            let v: Window = serde_json::from_value(value)?;
            text(&v.title, 160, true)?;
            order(v.order)?;
        }
        Kind::Tab => {
            let v: Tab = serde_json::from_value(value)?;
            if !valid_id(&v.window_id) {
                return Err(Error::Invalid);
            }
            text(&v.title, 512, true)?;
            order(v.order)?;
            v.tree.panes()?;
        }
        Kind::TabGroup => {
            let v: TabGroup = serde_json::from_value(value)?;
            text(&v.name, 160, true)?;
            if !TAB_GROUP_COLORS.contains(&v.color.as_str())
                || v.tab_ids.len() > 1024
                || v.tab_ids.iter().any(|id| !valid_id(id))
            {
                return Err(Error::Invalid);
            }
            order(v.order)?;
        }
        Kind::SavedTabGroup => {
            let v: SavedTabGroup = serde_json::from_value(value)?;
            text(&v.name, 160, true)?;
            if !TAB_GROUP_COLORS.contains(&v.color.as_str())
                || v.tabs.len() > 48 << 10
                || serde_json::from_str::<Value>(&v.tabs).map_or(true, |l| !l.is_array())
            {
                return Err(Error::Invalid);
            }
            order(v.order)?;
        }
        Kind::ExtensionRemoval => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Removed { extension:String, generation:String }
            let v:Removed=serde_json::from_value(value)?;
            if v.extension.is_empty() || v.extension.len()>256 || uuid::Uuid::parse_str(&v.generation).is_err() { return Err(Error::Invalid); }
        }
        Kind::ExtensionSyncKey => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct ExtensionValue { extension: String, generation: String, key: String, change: Value }
            let v: ExtensionValue = serde_json::from_value(value)?;
            if v.extension.is_empty() || v.extension.len() > 256 || !valid_id(&v.generation)
                || v.key.len() > 8192 || serde_json::to_vec(&v.change)?.len() + v.key.len() > 8192
                || !v.change.as_object().is_some_and(|change|change.len()==1 && (change.get("deleted")==Some(&Value::Bool(true)) || change.contains_key("value"))) {
                return Err(Error::Invalid);
            }
        }
        Kind::HistoryBatch => {
            let v: HistoryBatch = serde_json::from_value(value)?;
            if !valid_id(&v.origin) || v.hour < 0 || v.part > 64 || v.visits.len() > 2000 {
                return Err(Error::Invalid);
            }
            for visit in &v.visits {
                web_url(&visit.url)?;
                text(&visit.title, 512, true)?;
                if visit.visited_at / 3_600_000 != v.hour {
                    return Err(Error::Invalid);
                }
            }
        }
        Kind::View => {
            let v: View = serde_json::from_value(value)?;
            text(&v.title, 2048, true)?;
            order(v.placement.order)?;
            if !valid_id(&v.placement.tab_id)
                || !valid_id(&v.placement.pane_id)
                || v.bookmark_id.as_ref().is_some_and(|id| !valid_id(id))
            {
                return Err(Error::Invalid);
            }
            match v.surface {
                Surface::Browser => {
                    let url = v.url.as_deref().ok_or(Error::Invalid)?;
                    if url != "about:blank" {
                        let extension=url::Url::parse(url).is_ok_and(|u|u.scheme()=="webkit-extension" && u.username().is_empty() && u.password().is_none() && u.port().is_none() && u.host_str().is_some_and(|host|uuid::Uuid::parse_str(host).is_ok()));
                        if !extension { web_url(url)?; }
                    }
                    if !v.profile_id.as_deref().is_some_and(profile_id) || v.tool_route.is_some() {
                        return Err(Error::Invalid);
                    }
                }
                Surface::Home | Surface::Files | Surface::Agents | Surface::Space | Surface::Extensions => {
                    if v.url.is_some() || v.profile_id.is_some() || v.bookmark_id.is_some() {
                        return Err(Error::Invalid);
                    }
                    let route = v.tool_route.as_deref().ok_or(Error::Invalid)?;
                    text(route, 4096, false)?;
                    let path = route.split(['?', '#']).next().unwrap_or_default();
                    let prefix = match v.surface {
                        Surface::Home => "/home",
                        Surface::Files => "/files",
                        Surface::Space => "/spaces",
                        Surface::Extensions => "/extensions",
                        _ => "/agents",
                    };
                    if path != prefix && !path.starts_with(&format!("{prefix}/")) {
                        return Err(Error::Invalid);
                    }
                }
            }
        }
    }
    Ok(())
}

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
