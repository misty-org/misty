//! Workspace layout records: windows, split trees, tabs and views.
use super::*;

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
