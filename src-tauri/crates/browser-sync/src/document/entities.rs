use base64::Engine as _;
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, Result};

pub type Fields = BTreeMap<String, Value>;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Group,
    Website,
    Window,
    Layout,
    Tab,
}

impl Kind {
    pub fn key(self, id: &str) -> Result<String> {
        if !valid_id(id) || id.starts_with("recovery:") {
            return Err(Error::Invalid);
        }
        let kind = match self {
            Self::Group => "group",
            Self::Website => "website",
            Self::Window => "window",
            Self::Layout => "layout",
            Self::Tab => "tab",
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
pub struct Group {
    pub label: String,
    pub icon: String,
    pub order: f64,
    pub hidden: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Website {
    pub group_id: String,
    pub title: String,
    pub url: String,
    pub order: f64,
    pub pinned: bool,
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
pub struct Layout {
    pub window_id: String,
    pub title: String,
    pub order: f64,
    pub tree: SplitTree,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Surface {
    Browser,
    Files,
    Agents,
    Space,
}

/// Moving a view is one field: concurrent moves cannot combine a layout from
/// one device with a pane/order from another.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Placement {
    pub layout_id: String,
    pub pane_id: String,
    pub order: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tab {
    pub surface: Surface,
    pub title: String,
    pub placement: Placement,
    pub url: Option<String>,
    pub profile_id: Option<String>,
    pub website_id: Option<String>,
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
        Kind::Group => {
            let v: Group = serde_json::from_value(value)?;
            text(&v.label, 160, false)?;
            group_icon(&v.icon)?;
            order(v.order)?;
        }
        Kind::Website => {
            let v: Website = serde_json::from_value(value)?;
            if !valid_id(&v.group_id) {
                return Err(Error::Invalid);
            }
            text(&v.title, 512, false)?;
            web_url(&v.url)?;
            order(v.order)?;
        }
        Kind::Window => {
            let v: Window = serde_json::from_value(value)?;
            text(&v.title, 160, true)?;
            order(v.order)?;
        }
        Kind::Layout => {
            let v: Layout = serde_json::from_value(value)?;
            if !valid_id(&v.window_id) {
                return Err(Error::Invalid);
            }
            text(&v.title, 512, true)?;
            order(v.order)?;
            v.tree.panes()?;
        }
        Kind::Tab => {
            let v: Tab = serde_json::from_value(value)?;
            text(&v.title, 2048, true)?;
            order(v.placement.order)?;
            if !valid_id(&v.placement.layout_id)
                || !valid_id(&v.placement.pane_id)
                || v.website_id.as_ref().is_some_and(|id| !valid_id(id))
            {
                return Err(Error::Invalid);
            }
            match v.surface {
                Surface::Browser => {
                    let url = v.url.as_deref().ok_or(Error::Invalid)?;
                    if url != "about:blank" {
                        web_url(url)?;
                    }
                    if !v.profile_id.as_deref().is_some_and(profile_id) || v.tool_route.is_some() {
                        return Err(Error::Invalid);
                    }
                }
                Surface::Files | Surface::Agents | Surface::Space => {
                    if v.url.is_some() || v.profile_id.is_some() || v.website_id.is_some() {
                        return Err(Error::Invalid);
                    }
                    let route = v.tool_route.as_deref().ok_or(Error::Invalid)?;
                    text(route, 4096, false)?;
                    let path = route.split(['?', '#']).next().unwrap_or_default();
                    let prefix = match v.surface {
                        Surface::Files => "/files",
                        Surface::Space => "/spaces",
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
