use serde::{Deserialize, Serialize};
use serde_json::Value;

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
