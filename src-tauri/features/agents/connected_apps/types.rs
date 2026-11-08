//! What Composio's answers hold, kept to the fields Misty passes on, so what a connection's `state` holds
//! beside its display name is never decoded and can't reach the renderer.
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The parts of a session search Misty passes to the model.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SearchResult {
    pub success: bool,
    pub error: Option<String>,
    pub results: Vec<SearchTask>,
    pub toolkit_connection_statuses: Vec<SearchConnection>,
    pub tool_schemas: std::collections::BTreeMap<String, SearchSchema>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SearchTask {
    pub use_case: String,
    pub execution_guidance: String,
    pub recommended_plan_steps: Vec<String>,
    pub known_pitfalls: Vec<String>,
    pub primary_tool_slugs: Vec<String>,
    pub related_tool_slugs: Vec<String>,
    pub toolkits: Vec<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SearchConnection {
    pub toolkit: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SearchSchema {
    pub toolkit: String,
    pub description: String,
    pub input_schema: Option<Value>,
    #[serde(rename = "hasFullSchema")]
    pub has_full_schema: bool,
}

/// One tool run. A non-empty `error` is the provider's answer.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct Execution {
    /// `completed`, `failed`, `blocked` or `input_required`.
    pub result_type: Option<String>,
    pub data: Option<Value>,
    pub error: Option<String>,
    pub message: Option<String>,
    pub log_id: String,
}

/// A tool's identity and Composio's behavior tags.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ToolInfo {
    pub slug: String,
    pub name: String,
    pub tags: Vec<String>,
    pub toolkit: ToolToolkit,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ToolToolkit {
    pub slug: String,
    pub name: String,
}

/// One app in the catalog.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Toolkit {
    pub slug: String,
    pub name: String,
    pub meta: ToolkitMeta,
    pub connected_account: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ToolkitMeta {
    pub description: String,
}

/// A connected app account. Only the display name is read from Composio's `state`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Account {
    pub id: String,
    pub user_id: String,
    pub status: String,
    pub alias: Option<String>,
    pub is_disabled: bool,
    pub created_at: String,
    pub toolkit: AccountToolkit,
    pub state: AccountState,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct AccountToolkit {
    pub slug: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct AccountState {
    pub val: AccountValue,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct AccountValue {
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
}

impl Account {
    pub fn active(&self) -> bool {
        self.status == "ACTIVE" && !self.is_disabled
    }

    pub fn alias(&self) -> &str {
        self.alias.as_deref().unwrap_or_default()
    }
}

#[derive(Deserialize)]
pub(super) struct Page<T> {
    #[serde(default = "Vec::new")]
    pub(super) items: Vec<T>,
    #[serde(default)]
    pub(super) next_cursor: Option<String>,
}
