//! What the renderer sends to take a lease, and what it gets back.
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseRequest {
    pub(super) account_id: String,
    pub(super) agent_id: String,
    #[serde(default)]
    pub(super) space_id: String,
    pub(super) task_id: String,
    #[serde(default)]
    pub(super) renew: bool,
    /// The agent's own hidden session: it runs beside other tasks
    /// (docs/agents/evals/odysseys.md).
    #[serde(default)]
    pub(super) background: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseResult {
    pub window_label: String,
    pub task_id: String,
}
