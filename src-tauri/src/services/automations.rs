use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{fs, sync::Mutex};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    services::{ai::AiService, environment::AppEnvironmentService},
};

const STORE_VERSION: u32 = 1;
const MAX_RUNS: usize = 100;
const SCHEDULER_POLL_SECONDS: u64 = 30;
const HTTP_TIMEOUT_SECONDS: u64 = 30;
const SUPPORTED_NODE_KINDS: &[&str] = &[
    "manual_trigger",
    "schedule_trigger",
    "webhook_trigger",
    "select_path",
    "list_folder",
    "read_text",
    "read_metadata",
    "filter",
    "structured_prompt",
    "http_request",
    "write_text",
    "copy_path",
    "move_path",
    "rename_path",
    "notify",
];

#[derive(Clone)]
pub struct AutomationService {
    inner: Arc<AutomationServiceInner>,
}

struct AutomationServiceInner {
    workflows_path: PathBuf,
    runs_path: PathBuf,
    write_lock: Mutex<()>,
    ai: AiService,
    http: reqwest::Client,
    webhook_url: String,
    server_url: Option<String>,
    managed_ai_auth_token: Mutex<Option<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct ManagedAiCompletion {
    text: String,
    credits_used: i64,
    credits_remaining: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub interval_minutes: Option<u64>,
    pub last_scheduled_at: Option<String>,
    pub nodes: Vec<AutomationNode>,
    pub edges: Vec<AutomationEdge>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub position: AutomationPosition,
    #[serde(default)]
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationEdge {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub workflow_id: String,
    pub workflow_name: String,
    pub trigger: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub node_runs: Vec<AutomationNodeRun>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationNodeRun {
    pub node_id: String,
    pub label: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: String,
    pub output: Value,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationApproval {
    pub id: String,
    pub run_id: String,
    pub workflow_id: String,
    pub node_id: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub action: Value,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSnapshot {
    pub version: u32,
    pub webhook_url: String,
    pub workflows: Vec<AutomationWorkflow>,
    pub runs: Vec<AutomationRun>,
    pub approvals: Vec<AutomationApproval>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunRequest {
    pub workflow_id: String,
    #[serde(default = "manual_trigger")]
    pub trigger: String,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationValidation {
    pub valid: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct WorkflowStore {
    version: u32,
    workflows: Vec<AutomationWorkflow>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RunStore {
    version: u32,
    runs: Vec<AutomationRun>,
    approvals: Vec<AutomationApproval>,
}

impl Default for WorkflowStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            workflows: Vec::new(),
        }
    }
}

impl Default for RunStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            runs: Vec::new(),
            approvals: Vec::new(),
        }
    }
}

impl AutomationService {
    pub fn new(environment: AppEnvironmentService, ai: AiService) -> Self {
        let root = environment.config_dir().join("automations").join("v1");
        let server_url = environment.snapshot().server_url;
        let port = std::env::var("MISTY_AUTOMATION_WEBHOOK_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(17832);
        let service = Self {
            inner: Arc::new(AutomationServiceInner {
                workflows_path: root.join("workflows.json"),
                runs_path: root.join("runs.json"),
                write_lock: Mutex::new(()),
                ai,
                http: automation_http_client(),
                webhook_url: format!("http://127.0.0.1:{port}"),
                server_url,
                managed_ai_auth_token: Mutex::new(None),
            }),
        };
        service.start_webhook_server(port);
        service.start_scheduler();
        service
    }

    pub async fn set_managed_ai_auth(&self, token: String) {
        let normalized = token.trim().to_owned();
        *self.inner.managed_ai_auth_token.lock().await = if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        };
    }

    pub async fn snapshot(&self) -> ApiResult<AutomationSnapshot> {
        let workflows = load_json::<WorkflowStore>(&self.inner.workflows_path).await?;
        let runs = load_json::<RunStore>(&self.inner.runs_path).await?;
        Ok(AutomationSnapshot {
            version: STORE_VERSION,
            webhook_url: self.inner.webhook_url.clone(),
            workflows: workflows.workflows,
            runs: runs.runs,
            approvals: runs.approvals,
        })
    }

    fn start_webhook_server(&self, port: u16) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let app = Router::new()
                .route("/health", get(|| async { "Misty automations ready" }))
                .route("/hooks/{workflow_id}", post(run_webhook))
                .with_state(service);
            let address = format!("127.0.0.1:{port}");
            match tokio::net::TcpListener::bind(&address).await {
                Ok(listener) => {
                    if let Err(error) = axum::serve(listener, app).await {
                        eprintln!("Automation webhook server stopped: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("Automation webhook server unavailable at {address}: {error}")
                }
            }
        });
    }

    fn start_scheduler(&self) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            // Let runtime initialization finish before touching the persistent store.
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            loop {
                match service.claim_due_schedules().await {
                    Ok(workflow_ids) => {
                        for workflow_id in workflow_ids {
                            let scheduled_service = service.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(error) = scheduled_service
                                    .run(AutomationRunRequest {
                                        workflow_id: workflow_id.clone(),
                                        trigger: "schedule".to_owned(),
                                        input: Value::Null,
                                    })
                                    .await
                                {
                                    eprintln!(
                                        "Scheduled automation {workflow_id} failed to start: {error}"
                                    );
                                }
                            });
                        }
                    }
                    Err(error) => eprintln!("Automation scheduler failed: {error}"),
                }
                tokio::time::sleep(std::time::Duration::from_secs(SCHEDULER_POLL_SECONDS)).await;
            }
        });
    }

    async fn claim_due_schedules(&self) -> ApiResult<Vec<String>> {
        let _guard = self.inner.write_lock.lock().await;
        let mut store = load_json::<WorkflowStore>(&self.inner.workflows_path).await?;
        let now = Utc::now();
        let mut due = Vec::new();
        for workflow in &mut store.workflows {
            if schedule_is_due(workflow, now) {
                workflow.last_scheduled_at = Some(now.to_rfc3339());
                workflow.updated_at = now.to_rfc3339();
                due.push(workflow.id.clone());
            }
        }
        if !due.is_empty() {
            save_json(&self.inner.workflows_path, &store).await?;
        }
        Ok(due)
    }

    pub async fn save_workflow(
        &self,
        mut workflow: AutomationWorkflow,
    ) -> ApiResult<AutomationSnapshot> {
        let validation = validate_workflow(&workflow);
        if !validation.valid {
            return Err(ApiError::Message(validation.errors.join(" ")));
        }
        let _guard = self.inner.write_lock.lock().await;
        let mut store = load_json::<WorkflowStore>(&self.inner.workflows_path).await?;
        let now = Utc::now().to_rfc3339();
        workflow.name = workflow.name.trim().to_owned();
        workflow.updated_at = now.clone();
        if workflow.id.trim().is_empty() {
            workflow.id = Uuid::new_v4().to_string();
        }
        if let Some(existing) = store
            .workflows
            .iter_mut()
            .find(|item| item.id == workflow.id)
        {
            workflow.created_at = existing.created_at.clone();
            // Scheduling state is owned by the backend. An editor may have loaded the
            // workflow before the scheduler claimed its latest interval.
            workflow.last_scheduled_at = existing.last_scheduled_at.clone();
            *existing = workflow;
        } else {
            if workflow.created_at.is_empty() {
                workflow.created_at = now;
            }
            store.workflows.push(workflow);
        }
        save_json(&self.inner.workflows_path, &store).await?;
        drop(_guard);
        self.snapshot().await
    }

    pub async fn delete_workflow(&self, workflow_id: &str) -> ApiResult<AutomationSnapshot> {
        let _guard = self.inner.write_lock.lock().await;
        let mut store = load_json::<WorkflowStore>(&self.inner.workflows_path).await?;
        store.workflows.retain(|item| item.id != workflow_id);
        save_json(&self.inner.workflows_path, &store).await?;
        let mut run_store = load_json::<RunStore>(&self.inner.runs_path).await?;
        run_store
            .runs
            .retain(|item| item.workflow_id != workflow_id);
        run_store
            .approvals
            .retain(|item| item.workflow_id != workflow_id);
        save_json(&self.inner.runs_path, &run_store).await?;
        drop(_guard);
        self.snapshot().await
    }

    pub fn validate(&self, workflow: &AutomationWorkflow) -> AutomationValidation {
        validate_workflow(workflow)
    }

    pub async fn run(&self, request: AutomationRunRequest) -> ApiResult<AutomationSnapshot> {
        if !matches!(request.trigger.as_str(), "manual" | "schedule" | "webhook") {
            return Err(ApiError::Message(format!(
                "Unsupported automation trigger: {}",
                request.trigger
            )));
        }
        let workflows = load_json::<WorkflowStore>(&self.inner.workflows_path).await?;
        let workflow = workflows
            .workflows
            .into_iter()
            .find(|item| item.id == request.workflow_id)
            .ok_or_else(|| ApiError::Message("Automation workflow was not found.".to_owned()))?;
        if request.trigger != "manual" && !workflow.enabled {
            return Err(ApiError::Message(
                "This automation is disabled. Enable it before using scheduled or webhook triggers."
                    .to_owned(),
            ));
        }
        let validation = validate_workflow(&workflow);
        if !validation.valid {
            return Err(ApiError::Message(validation.errors.join(" ")));
        }

        let mut run = AutomationRun {
            id: Uuid::new_v4().to_string(),
            workflow_id: workflow.id.clone(),
            workflow_name: workflow.name.clone(),
            trigger: request.trigger,
            status: "running".to_owned(),
            started_at: Utc::now().to_rfc3339(),
            finished_at: None,
            node_runs: Vec::new(),
            error: None,
        };
        let mut approvals = Vec::new();
        if let Err(error) = self
            .execute(&workflow, &mut run, &mut approvals, request.input)
            .await
        {
            run.status = "failed".to_owned();
            run.error = Some(error.to_string());
            run.finished_at = Some(Utc::now().to_rfc3339());
        } else if approvals.is_empty() {
            run.status = "completed".to_owned();
            run.finished_at = Some(Utc::now().to_rfc3339());
        } else {
            run.status = "waiting_approval".to_owned();
        }
        self.record_run(run, approvals).await?;
        self.snapshot().await
    }

    pub async fn resolve_approval(
        &self,
        approval_id: &str,
        approved: bool,
    ) -> ApiResult<AutomationSnapshot> {
        let _guard = self.inner.write_lock.lock().await;
        let mut store = load_json::<RunStore>(&self.inner.runs_path).await?;
        let approval = store
            .approvals
            .iter_mut()
            .find(|item| item.id == approval_id)
            .ok_or_else(|| ApiError::Message("Automation approval was not found.".to_owned()))?;
        if approval.status != "pending" {
            return Err(ApiError::Message(
                "Automation approval is already resolved.".to_owned(),
            ));
        }
        if approved {
            execute_file_action(&approval.action).await?;
        }
        let node_id = approval.node_id.clone();
        approval.status = if approved { "approved" } else { "rejected" }.to_owned();
        approval.resolved_at = Some(Utc::now().to_rfc3339());
        let run_id = approval.run_id.clone();
        let pending = store
            .approvals
            .iter()
            .any(|item| item.run_id == run_id && item.status == "pending");
        if let Some(run) = store.runs.iter_mut().find(|item| item.id == run_id) {
            if let Some(node_run) = run
                .node_runs
                .iter_mut()
                .find(|item| item.node_id == node_id)
            {
                node_run.status = if approved { "completed" } else { "rejected" }.to_owned();
            }
        }
        if !pending {
            if let Some(run) = store.runs.iter_mut().find(|item| item.id == run_id) {
                run.status = if store
                    .approvals
                    .iter()
                    .any(|item| item.run_id == run_id && item.status == "rejected")
                {
                    "rejected"
                } else {
                    "completed"
                }
                .to_owned();
                run.finished_at = Some(Utc::now().to_rfc3339());
            }
        }
        save_json(&self.inner.runs_path, &store).await?;
        drop(_guard);
        self.snapshot().await
    }

    async fn record_run(
        &self,
        run: AutomationRun,
        approvals: Vec<AutomationApproval>,
    ) -> ApiResult<()> {
        let _guard = self.inner.write_lock.lock().await;
        let mut store = load_json::<RunStore>(&self.inner.runs_path).await?;
        store.runs.insert(0, run);
        store.runs.truncate(MAX_RUNS);
        store.approvals.extend(approvals);
        store
            .approvals
            .retain(|item| store.runs.iter().any(|run| run.id == item.run_id));
        save_json(&self.inner.runs_path, &store).await
    }

    async fn execute(
        &self,
        workflow: &AutomationWorkflow,
        run: &mut AutomationRun,
        approvals: &mut Vec<AutomationApproval>,
        input: Value,
    ) -> ApiResult<()> {
        let order = execution_order(workflow, &run.trigger)?;
        let mut outputs: HashMap<String, Value> = HashMap::new();
        for node_id in order {
            let node = workflow
                .nodes
                .iter()
                .find(|item| item.id == node_id)
                .expect("validated node");
            let started_at = Utc::now().to_rfc3339();
            let node_input =
                incoming_value(workflow, &outputs, &node.id).unwrap_or_else(|| input.clone());
            let result = self.execute_node(node, &node_input, run, approvals).await;
            let finished_at = Utc::now().to_rfc3339();
            match result {
                Ok(output) => {
                    outputs.insert(node.id.clone(), output.clone());
                    run.node_runs.push(AutomationNodeRun {
                        node_id: node.id.clone(),
                        label: node.label.clone(),
                        status: if is_write_kind(&node.kind) {
                            "waiting_approval"
                        } else {
                            "completed"
                        }
                        .to_owned(),
                        started_at,
                        finished_at,
                        output,
                        error: None,
                    });
                }
                Err(error) => {
                    run.node_runs.push(AutomationNodeRun {
                        node_id: node.id.clone(),
                        label: node.label.clone(),
                        status: "failed".to_owned(),
                        started_at,
                        finished_at,
                        output: Value::Null,
                        error: Some(error.to_string()),
                    });
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    async fn execute_node(
        &self,
        node: &AutomationNode,
        input: &Value,
        run: &AutomationRun,
        approvals: &mut Vec<AutomationApproval>,
    ) -> ApiResult<Value> {
        match node.kind.as_str() {
            "manual_trigger" | "schedule_trigger" | "webhook_trigger" => Ok(input.clone()),
            "select_path" => {
                let paths = config_paths(&node.config);
                let value = if paths.len() == 1 {
                    Value::String(paths[0].clone())
                } else {
                    serde_json::to_value(&paths)?
                };
                Ok(json!({ "paths": paths, "value": value }))
            }
            "list_folder" => list_folder(render_config(&node.config, "path", input)).await,
            "read_text" => {
                let path = render_config(&node.config, "path", input);
                let text = fs::read_to_string(&path).await.map_err(io_error)?;
                Ok(json!({ "path": path, "text": text, "value": text }))
            }
            "read_metadata" => read_metadata(render_config(&node.config, "path", input)).await,
            "filter" => filter_values(
                input,
                node.config
                    .get("contains")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            ),
            "structured_prompt" => {
                let prompt = render_template(
                    node.config
                        .get("prompt")
                        .and_then(Value::as_str)
                        .unwrap_or("{{input}}"),
                    input,
                );
                let completion = self.managed_ai_complete(&prompt).await?;
                Ok(
                    json!({ "text": completion.text.clone(), "value": completion.text, "prompt": prompt,
                    "creditsUsed": completion.credits_used, "creditsRemaining": completion.credits_remaining }),
                )
            }
            "http_request" => self.http_request(node, input).await,
            "notify" => Ok(
                json!({ "message": render_config(&node.config, "message", input), "value": input }),
            ),
            kind if is_write_kind(kind) => {
                let action = build_file_action(node, input)?;
                approvals.push(AutomationApproval {
                    id: Uuid::new_v4().to_string(),
                    run_id: run.id.clone(),
                    workflow_id: run.workflow_id.clone(),
                    node_id: node.id.clone(),
                    title: node.label.clone(),
                    summary: action_summary(&action),
                    status: "pending".to_owned(),
                    action: action.clone(),
                    created_at: Utc::now().to_rfc3339(),
                    resolved_at: None,
                });
                Ok(json!({ "approvalRequired": true, "action": action }))
            }
            _ => Err(ApiError::Message(format!(
                "Unsupported automation node: {}",
                node.kind
            ))),
        }
    }

    async fn managed_ai_complete(&self, prompt: &str) -> ApiResult<ManagedAiCompletion> {
        let Some(server_url) = self.inner.server_url.as_deref() else {
            #[cfg(test)]
            return Ok(ManagedAiCompletion {
                text: self.inner.ai.complete(prompt, None).await?,
                credits_used: 0,
                credits_remaining: 0,
            });
            #[cfg(not(test))]
            return Err(ApiError::Message(
                "Misty server is not configured for managed AI automation.".to_owned(),
            ));
        };
        let token = self
            .inner
            .managed_ai_auth_token
            .lock()
            .await
            .clone()
            .ok_or_else(|| ApiError::Message("Sign in to use AI automation credits.".to_owned()))?;
        let base = server_url.trim_end_matches('/');
        let url = if base.ends_with("/api") {
            format!("{base}/ai/complete")
        } else {
            format!("{base}/api/ai/complete")
        };
        let response = self
            .inner
            .http
            .post(url)
            .bearer_auth(token)
            .json(&json!({ "prompt": prompt }))
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            if status.as_u16() == 402 {
                return Err(ApiError::Message(
                    "Misty credits exhausted. Add credits or wait for the monthly reset."
                        .to_owned(),
                ));
            }
            return Err(ApiError::Message(format!(
                "Managed AI request failed ({}): {}",
                status.as_u16(),
                truncate_for_error(&body, 500)
            )));
        }
        serde_json::from_str(&body).map_err(Into::into)
    }

    async fn http_request(&self, node: &AutomationNode, input: &Value) -> ApiResult<Value> {
        let method = node
            .config
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("GET")
            .to_uppercase();
        let url = render_config(&node.config, "url", input);
        let method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|error| ApiError::Message(error.to_string()))?;
        let mut request = self.inner.http.request(method, &url);
        if let Some(headers) = node.config.get("headers").and_then(Value::as_object) {
            for (key, value) in headers {
                if let Some(value) = value.as_str() {
                    request = request.header(key, render_template(value, input));
                }
            }
        }
        if let Some(body) = node
            .config
            .get("body")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            request = request.body(render_template(body, input));
        }
        let response = request.send().await?;
        let status = response.status().as_u16();
        let text = response.text().await?;
        if !(200..300).contains(&status) {
            let detail = if text.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", truncate_for_error(&text, 500))
            };
            return Err(ApiError::Message(format!(
                "HTTP request returned status {status}{detail}"
            )));
        }
        Ok(json!({ "status": status, "body": text, "value": text, "url": url }))
    }
}

async fn run_webhook(
    AxumPath(workflow_id): AxumPath<String>,
    State(service): State<AutomationService>,
    Json(input): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let snapshot = service
        .run(AutomationRunRequest {
            workflow_id: workflow_id.clone(),
            trigger: "webhook".to_owned(),
            input,
        })
        .await
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    let run = snapshot
        .runs
        .iter()
        .find(|run| run.workflow_id == workflow_id)
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Automation run was not recorded.".to_owned(),
            )
        })?;
    Ok(Json(json!({
        "accepted": run.status != "failed",
        "runId": run.id,
        "status": run.status,
    })))
}

fn manual_trigger() -> String {
    "manual".to_owned()
}

fn validate_workflow(workflow: &AutomationWorkflow) -> AutomationValidation {
    let mut errors = Vec::new();
    if workflow.name.trim().is_empty() {
        errors.push("Workflow name is required.".to_owned());
    }
    if workflow.nodes.is_empty() {
        errors.push("Add at least one node.".to_owned());
    }
    if workflow.nodes.iter().any(|node| node.id.trim().is_empty()) {
        errors.push("Node IDs cannot be empty.".to_owned());
    }
    if workflow
        .nodes
        .iter()
        .any(|node| node.label.trim().is_empty())
    {
        errors.push("Every node needs a label.".to_owned());
    }
    let unsupported: Vec<&str> = workflow
        .nodes
        .iter()
        .filter(|node| !SUPPORTED_NODE_KINDS.contains(&node.kind.as_str()))
        .map(|node| node.kind.as_str())
        .collect();
    if !unsupported.is_empty() {
        errors.push(format!(
            "Unsupported node kinds: {}.",
            unsupported.join(", ")
        ));
    }
    let ids: HashSet<&str> = workflow.nodes.iter().map(|node| node.id.as_str()).collect();
    if ids.len() != workflow.nodes.len() {
        errors.push("Node IDs must be unique.".to_owned());
    }
    let edge_ids: HashSet<&str> = workflow.edges.iter().map(|edge| edge.id.as_str()).collect();
    if workflow.edges.iter().any(|edge| edge.id.trim().is_empty()) {
        errors.push("Edge IDs cannot be empty.".to_owned());
    }
    if edge_ids.len() != workflow.edges.len() {
        errors.push("Edge IDs must be unique.".to_owned());
    }
    let mut connections = HashSet::new();
    for edge in &workflow.edges {
        if !connections.insert((edge.source.as_str(), edge.target.as_str())) {
            errors.push("Duplicate connections are not allowed.".to_owned());
        }
        if !ids.contains(edge.source.as_str()) || !ids.contains(edge.target.as_str()) {
            errors.push(format!("Edge {} points to a missing node.", edge.id));
        }
        if edge.source == edge.target {
            errors.push("A node cannot connect to itself.".to_owned());
        }
        if workflow
            .nodes
            .iter()
            .any(|node| node.id == edge.source && is_write_kind(&node.kind))
        {
            errors.push(
                "File write, copy, move, and rename nodes must be terminal nodes in V1.".to_owned(),
            );
        }
        if workflow
            .nodes
            .iter()
            .any(|node| node.id == edge.target && node.kind.ends_with("_trigger"))
        {
            errors.push("Trigger nodes cannot have incoming connections.".to_owned());
        }
    }
    if workflow
        .nodes
        .iter()
        .filter(|node| node.kind.ends_with("_trigger"))
        .count()
        == 0
    {
        errors.push("Add a trigger node.".to_owned());
    }
    if topological_order(workflow).is_err() {
        errors.push("Workflow contains a cycle.".to_owned());
    }
    let reachable = trigger_reachable_nodes(workflow);
    if workflow
        .nodes
        .iter()
        .any(|node| !reachable.contains(&node.id))
    {
        errors.push("Every node must be connected to a trigger.".to_owned());
    }
    if workflow.enabled
        && workflow.interval_minutes.is_some()
        && !workflow
            .nodes
            .iter()
            .any(|node| node.kind == "schedule_trigger")
    {
        errors.push("An enabled schedule needs a Schedule trigger node.".to_owned());
    }
    if workflow.interval_minutes == Some(0) {
        errors.push("Schedule interval must be at least one minute.".to_owned());
    }
    AutomationValidation {
        valid: errors.is_empty(),
        errors,
    }
}

fn trigger_reachable_nodes(workflow: &AutomationWorkflow) -> HashSet<String> {
    let mut reachable: HashSet<String> = workflow
        .nodes
        .iter()
        .filter(|node| node.kind.ends_with("_trigger"))
        .map(|node| node.id.clone())
        .collect();
    let mut queue: VecDeque<String> = reachable.iter().cloned().collect();
    while let Some(source) = queue.pop_front() {
        for target in workflow
            .edges
            .iter()
            .filter(|edge| edge.source == source)
            .map(|edge| edge.target.clone())
        {
            if reachable.insert(target.clone()) {
                queue.push_back(target);
            }
        }
    }
    reachable
}

fn schedule_is_due(workflow: &AutomationWorkflow, now: chrono::DateTime<Utc>) -> bool {
    let Some(interval_minutes) = workflow.interval_minutes.filter(|value| *value > 0) else {
        return false;
    };
    if !workflow.enabled
        || !workflow
            .nodes
            .iter()
            .any(|node| node.kind == "schedule_trigger")
    {
        return false;
    }
    let Some(last) = workflow
        .last_scheduled_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
    else {
        return true;
    };
    now.signed_duration_since(last.with_timezone(&Utc))
        .num_seconds()
        >= (interval_minutes.saturating_mul(60)) as i64
}

fn truncate_for_error(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn topological_order(workflow: &AutomationWorkflow) -> ApiResult<Vec<String>> {
    let mut degree: HashMap<String, usize> = workflow
        .nodes
        .iter()
        .map(|node| (node.id.clone(), 0))
        .collect();
    let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
    for edge in &workflow.edges {
        if let Some(value) = degree.get_mut(&edge.target) {
            *value += 1;
        }
        outgoing
            .entry(edge.source.clone())
            .or_default()
            .push(edge.target.clone());
    }
    let node_order: HashMap<&str, usize> = workflow
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.as_str(), index))
        .collect();
    let mut queue: Vec<String> = workflow
        .nodes
        .iter()
        .filter(|node| degree.get(&node.id) == Some(&0))
        .map(|node| node.id.clone())
        .collect();
    let mut order = Vec::new();
    while !queue.is_empty() {
        let id = queue.remove(0);
        order.push(id.clone());
        for target in outgoing.get(&id).into_iter().flatten() {
            if let Some(value) = degree.get_mut(target) {
                *value -= 1;
                if *value == 0 {
                    queue.push(target.clone());
                    queue.sort_by_key(|id| {
                        node_order.get(id.as_str()).copied().unwrap_or(usize::MAX)
                    });
                }
            }
        }
    }
    if order.len() != workflow.nodes.len() {
        return Err(ApiError::Message("Workflow contains a cycle.".to_owned()));
    }
    Ok(order)
}

fn execution_order(workflow: &AutomationWorkflow, trigger: &str) -> ApiResult<Vec<String>> {
    let kind = match trigger {
        "schedule" => "schedule_trigger",
        "webhook" => "webhook_trigger",
        _ => "manual_trigger",
    };
    let roots: Vec<String> = workflow
        .nodes
        .iter()
        .filter(|node| node.kind == kind)
        .map(|node| node.id.clone())
        .collect();
    if roots.is_empty() {
        return Err(ApiError::Message(format!(
            "This workflow does not have a {trigger} trigger."
        )));
    }
    let mut reachable: HashSet<String> = roots.iter().cloned().collect();
    let mut queue: VecDeque<String> = roots.into();
    while let Some(source) = queue.pop_front() {
        for target in workflow
            .edges
            .iter()
            .filter(|edge| edge.source == source)
            .map(|edge| edge.target.clone())
        {
            if reachable.insert(target.clone()) {
                queue.push_back(target);
            }
        }
    }
    Ok(topological_order(workflow)?
        .into_iter()
        .filter(|id| reachable.contains(id))
        .collect())
}

fn incoming_value(
    workflow: &AutomationWorkflow,
    outputs: &HashMap<String, Value>,
    node_id: &str,
) -> Option<Value> {
    let values: Vec<Value> = workflow
        .edges
        .iter()
        .filter(|edge| edge.target == node_id)
        .filter_map(|edge| outputs.get(&edge.source).cloned())
        .collect();
    match values.len() {
        0 => None,
        1 => values.into_iter().next(),
        _ => Some(Value::Array(values)),
    }
}

fn render_config(config: &Value, key: &str, input: &Value) -> String {
    render_template(config.get(key).and_then(Value::as_str).unwrap_or(""), input)
}

fn render_template(template: &str, input: &Value) -> String {
    let mut result = template.replace("{{input}}", &value_text(input));
    if let Some(object) = input.as_object() {
        for (key, value) in object {
            result = result.replace(&format!("{{{{{key}}}}}"), &value_text(value));
        }
    }
    result
}

fn value_text(value: &Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default())
}

fn config_paths(config: &Value) -> Vec<String> {
    config
        .get("paths")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

async fn list_folder(path: String) -> ApiResult<Value> {
    let mut entries = fs::read_dir(&path).await.map_err(io_error)?;
    let mut values = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(io_error)? {
        let metadata = entry.metadata().await.map_err(io_error)?;
        values.push(json!({ "name": entry.file_name().to_string_lossy(), "path": entry.path(), "isDir": metadata.is_dir(), "size": metadata.len() }));
    }
    Ok(json!({ "path": path, "items": values, "value": values }))
}

async fn read_metadata(path: String) -> ApiResult<Value> {
    let metadata = fs::metadata(&path).await.map_err(io_error)?;
    Ok(
        json!({ "path": path, "isDir": metadata.is_dir(), "size": metadata.len(), "readonly": metadata.permissions().readonly(), "value": path }),
    )
}

fn filter_values(input: &Value, contains: &str) -> ApiResult<Value> {
    let source = input
        .get("items")
        .and_then(Value::as_array)
        .or_else(|| input.as_array())
        .cloned()
        .unwrap_or_default();
    let needle = contains.to_lowercase();
    let items: Vec<Value> = source
        .into_iter()
        .filter(|item| needle.is_empty() || value_text(item).to_lowercase().contains(&needle))
        .collect();
    Ok(json!({ "items": items, "value": items }))
}

fn is_write_kind(kind: &str) -> bool {
    matches!(
        kind,
        "write_text" | "copy_path" | "move_path" | "rename_path"
    )
}

fn build_file_action(node: &AutomationNode, input: &Value) -> ApiResult<Value> {
    let action = match node.kind.as_str() {
        "write_text" => {
            json!({ "kind": "write_text", "path": render_config(&node.config, "path", input), "text": render_config(&node.config, "text", input) })
        }
        "copy_path" => {
            json!({ "kind": "copy_path", "source": render_config(&node.config, "source", input), "destination": render_config(&node.config, "destination", input) })
        }
        "move_path" => {
            json!({ "kind": "move_path", "source": render_config(&node.config, "source", input), "destination": render_config(&node.config, "destination", input) })
        }
        "rename_path" => {
            json!({ "kind": "rename_path", "source": render_config(&node.config, "source", input), "destination": render_config(&node.config, "destination", input) })
        }
        _ => return Err(ApiError::Message("Unsupported file action.".to_owned())),
    };
    if action
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(key, _)| *key != "kind")
        .any(|(_, value)| value.as_str().unwrap_or("").trim().is_empty())
    {
        return Err(ApiError::Message(format!(
            "{} needs all path/text fields configured.",
            node.label
        )));
    }
    Ok(action)
}

fn action_summary(action: &Value) -> String {
    match action.get("kind").and_then(Value::as_str).unwrap_or("") {
        "write_text" => format!("Write text to {}", action["path"].as_str().unwrap_or("")),
        "copy_path" => format!(
            "Copy {} to {}",
            action["source"].as_str().unwrap_or(""),
            action["destination"].as_str().unwrap_or("")
        ),
        "move_path" | "rename_path" => format!(
            "Move {} to {}",
            action["source"].as_str().unwrap_or(""),
            action["destination"].as_str().unwrap_or("")
        ),
        _ => "Run file action".to_owned(),
    }
}

async fn execute_file_action(action: &Value) -> ApiResult<()> {
    let kind = action.get("kind").and_then(Value::as_str).unwrap_or("");
    match kind {
        "write_text" => {
            let path = PathBuf::from(action["path"].as_str().unwrap_or(""));
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).await.map_err(io_error)?;
            }
            fs::write(path, action["text"].as_str().unwrap_or(""))
                .await
                .map_err(io_error)?;
        }
        "copy_path" => {
            copy_recursively(
                Path::new(action["source"].as_str().unwrap_or("")),
                Path::new(action["destination"].as_str().unwrap_or("")),
            )
            .await?
        }
        "move_path" | "rename_path" => fs::rename(
            action["source"].as_str().unwrap_or(""),
            action["destination"].as_str().unwrap_or(""),
        )
        .await
        .map_err(io_error)?,
        _ => return Err(ApiError::Message("Unsupported approval action.".to_owned())),
    }
    Ok(())
}

async fn copy_recursively(source: &Path, destination: &Path) -> ApiResult<()> {
    if source.is_file() {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await.map_err(io_error)?;
        }
        fs::copy(source, destination).await.map_err(io_error)?;
        return Ok(());
    }
    let source = source.to_owned();
    let destination = destination.to_owned();
    tokio::task::spawn_blocking(move || {
        for entry in walkdir::WalkDir::new(&source) {
            let entry = entry.map_err(|error| ApiError::Message(error.to_string()))?;
            let target = destination.join(
                entry
                    .path()
                    .strip_prefix(&source)
                    .map_err(|error| ApiError::Message(error.to_string()))?,
            );
            if entry.file_type().is_dir() {
                std::fs::create_dir_all(&target).map_err(io_error)?;
            } else {
                std::fs::copy(entry.path(), target).map_err(io_error)?;
            }
        }
        Ok::<(), ApiError>(())
    })
    .await
    .map_err(|error| ApiError::Message(error.to_string()))?
}

async fn load_json<T>(path: &Path) -> ApiResult<T>
where
    T: for<'de> Deserialize<'de> + Default,
{
    match fs::read(path).await {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(io_error(error)),
    }
}

async fn save_json<T: Serialize>(path: &Path, value: &T) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.map_err(io_error)?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(value)?)
        .await
        .map_err(io_error)?;
    match fs::rename(&temporary, path).await {
        Ok(()) => Ok(()),
        #[cfg(target_os = "windows")]
        Err(error)
            if path.exists()
                && matches!(
                    error.kind(),
                    std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied
                ) =>
        {
            fs::remove_file(path).await.map_err(io_error)?;
            fs::rename(temporary, path).await.map_err(io_error)
        }
        Err(error) => Err(io_error(error)),
    }
}

fn automation_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        // Never resend automation or managed Mika POST bodies through redirects.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("valid automation HTTP client")
}

fn io_error(error: std::io::Error) -> ApiError {
    ApiError::Message(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_service(root: &Path) -> AutomationService {
        AutomationService {
            inner: Arc::new(AutomationServiceInner {
                workflows_path: root.join("workflows.json"),
                runs_path: root.join("runs.json"),
                write_lock: Mutex::new(()),
                ai: AiService::new(),
                http: automation_http_client(),
                webhook_url: "http://127.0.0.1:0".to_owned(),
                server_url: None,
                managed_ai_auth_token: Mutex::new(None),
            }),
        }
    }

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("misty-automations-{label}-{}", Uuid::new_v4()))
    }

    fn workflow(edges: Vec<AutomationEdge>) -> AutomationWorkflow {
        let node = |id: &str, kind: &str| AutomationNode {
            id: id.to_owned(),
            kind: kind.to_owned(),
            label: id.to_owned(),
            position: AutomationPosition { x: 0.0, y: 0.0 },
            config: json!({}),
        };
        AutomationWorkflow {
            id: "test".to_owned(),
            name: "Test".to_owned(),
            description: String::new(),
            enabled: false,
            interval_minutes: None,
            last_scheduled_at: None,
            nodes: vec![node("a", "manual_trigger"), node("b", "notify")],
            edges,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn validates_connected_acyclic_graph() {
        let value = workflow(vec![AutomationEdge {
            id: "e".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        }]);
        assert!(validate_workflow(&value).valid);
        assert_eq!(topological_order(&value).unwrap(), vec!["a", "b"]);
    }

    #[test]
    fn rejects_cycles() {
        let value = workflow(vec![
            AutomationEdge {
                id: "e1".to_owned(),
                source: "a".to_owned(),
                target: "b".to_owned(),
            },
            AutomationEdge {
                id: "e2".to_owned(),
                source: "b".to_owned(),
                target: "a".to_owned(),
            },
        ]);
        assert!(!validate_workflow(&value).valid);
    }

    #[test]
    fn branch_execution_order_is_stable() {
        let node = |id: &str, kind: &str| AutomationNode {
            id: id.to_owned(),
            kind: kind.to_owned(),
            label: id.to_owned(),
            position: AutomationPosition { x: 0.0, y: 0.0 },
            config: json!({}),
        };
        let value = AutomationWorkflow {
            id: "branches".to_owned(),
            name: "Branches".to_owned(),
            description: String::new(),
            enabled: false,
            interval_minutes: None,
            last_scheduled_at: None,
            nodes: vec![
                node("trigger", "manual_trigger"),
                node("first", "notify"),
                node("second", "notify"),
            ],
            edges: vec![
                AutomationEdge {
                    id: "second-edge".to_owned(),
                    source: "trigger".to_owned(),
                    target: "second".to_owned(),
                },
                AutomationEdge {
                    id: "first-edge".to_owned(),
                    source: "trigger".to_owned(),
                    target: "first".to_owned(),
                },
            ],
            created_at: String::new(),
            updated_at: String::new(),
        };

        assert_eq!(
            topological_order(&value).unwrap(),
            vec!["trigger", "first", "second"]
        );
    }

    #[test]
    fn rejects_duplicate_connections_and_edge_ids() {
        let value = workflow(vec![
            AutomationEdge {
                id: "same".to_owned(),
                source: "a".to_owned(),
                target: "b".to_owned(),
            },
            AutomationEdge {
                id: "same".to_owned(),
                source: "a".to_owned(),
                target: "b".to_owned(),
            },
        ]);
        let validation = validate_workflow(&value);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("Edge IDs")));
        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("Duplicate connections")));
    }

    #[test]
    fn rejects_nodes_that_are_not_reachable_from_a_trigger() {
        let mut value = workflow(Vec::new());
        let validation = validate_workflow(&value);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("connected to a trigger")));

        value.edges.push(AutomationEdge {
            id: "connected".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        });
        assert!(validate_workflow(&value).valid);
    }

    #[test]
    fn executes_only_the_requested_trigger_branch() {
        let mut value = workflow(vec![AutomationEdge {
            id: "manual-edge".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        }]);
        value.nodes.push(AutomationNode {
            id: "webhook".to_owned(),
            kind: "webhook_trigger".to_owned(),
            label: "Webhook".to_owned(),
            position: AutomationPosition { x: 0.0, y: 0.0 },
            config: json!({}),
        });
        value.nodes.push(AutomationNode {
            id: "webhook-output".to_owned(),
            kind: "notify".to_owned(),
            label: "Webhook output".to_owned(),
            position: AutomationPosition { x: 0.0, y: 0.0 },
            config: json!({}),
        });
        value.edges.push(AutomationEdge {
            id: "webhook-edge".to_owned(),
            source: "webhook".to_owned(),
            target: "webhook-output".to_owned(),
        });

        assert_eq!(execution_order(&value, "manual").unwrap(), vec!["a", "b"]);
        assert_eq!(
            execution_order(&value, "webhook").unwrap(),
            vec!["webhook", "webhook-output"]
        );
    }

    #[test]
    fn schedule_due_state_respects_enabled_interval_and_last_run() {
        let now = Utc::now();
        let mut value = workflow(vec![AutomationEdge {
            id: "scheduled-edge".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        }]);
        value.nodes[0].kind = "schedule_trigger".to_owned();
        value.enabled = true;
        value.interval_minutes = Some(15);

        assert!(schedule_is_due(&value, now));
        value.last_scheduled_at = Some((now - chrono::Duration::minutes(14)).to_rfc3339());
        assert!(!schedule_is_due(&value, now));
        value.last_scheduled_at = Some((now - chrono::Duration::minutes(15)).to_rfc3339());
        assert!(schedule_is_due(&value, now));
        value.enabled = false;
        assert!(!schedule_is_due(&value, now));
    }

    #[test]
    fn safely_truncates_unicode_error_bodies() {
        assert_eq!(truncate_for_error("abcdef", 3), "abc…");
        assert_eq!(truncate_for_error("🦀🦀", 1), "🦀…");
        assert_eq!(truncate_for_error("short", 20), "short");
    }

    #[tokio::test]
    async fn saves_reloads_and_runs_a_manual_workflow() {
        let root = test_root("manual");
        let service = test_service(&root);
        let value = workflow(vec![AutomationEdge {
            id: "manual-edge".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        }]);

        let saved = service.save_workflow(value).await.unwrap();
        assert_eq!(saved.workflows.len(), 1);
        assert!(!saved.workflows[0].created_at.is_empty());
        let reloaded = service.snapshot().await.unwrap();
        assert_eq!(reloaded.workflows[0].name, "Test");

        let result = service
            .run(AutomationRunRequest {
                workflow_id: "test".to_owned(),
                trigger: "manual".to_owned(),
                input: json!({"message": "hello"}),
            })
            .await
            .unwrap();
        assert_eq!(result.runs.len(), 1);
        assert_eq!(result.runs[0].status, "completed");
        assert_eq!(result.runs[0].node_runs.len(), 2);
        assert_eq!(result.runs[0].node_runs[1].output["message"], "");

        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn file_actions_wait_for_approval_and_update_persisted_status() {
        let root = test_root("approval");
        let output_path = root.join("output").join("approved.txt");
        let service = test_service(&root);
        let mut value = workflow(vec![AutomationEdge {
            id: "write-edge".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        }]);
        value.nodes[1].kind = "write_text".to_owned();
        value.nodes[1].config = json!({
            "path": output_path.to_string_lossy(),
            "text": "approved content"
        });
        service.save_workflow(value).await.unwrap();

        let waiting = service
            .run(AutomationRunRequest {
                workflow_id: "test".to_owned(),
                trigger: "manual".to_owned(),
                input: Value::Null,
            })
            .await
            .unwrap();
        assert_eq!(waiting.runs[0].status, "waiting_approval");
        assert_eq!(waiting.runs[0].node_runs[1].status, "waiting_approval");
        assert!(!output_path.exists());

        let resolved = service
            .resolve_approval(&waiting.approvals[0].id, true)
            .await
            .unwrap();
        assert_eq!(resolved.runs[0].status, "completed");
        assert_eq!(resolved.runs[0].node_runs[1].status, "completed");
        assert_eq!(resolved.approvals[0].status, "approved");
        assert_eq!(
            fs::read_to_string(&output_path).await.unwrap(),
            "approved content"
        );

        let second_run = service
            .run(AutomationRunRequest {
                workflow_id: "test".to_owned(),
                trigger: "manual".to_owned(),
                input: Value::Null,
            })
            .await
            .unwrap();
        let second_run_id = second_run.runs[0].id.clone();
        let second_approval = second_run
            .approvals
            .iter()
            .find(|item| item.run_id == second_run_id)
            .unwrap();
        let rejected = service
            .resolve_approval(&second_approval.id, false)
            .await
            .unwrap();
        let rejected_run = rejected
            .runs
            .iter()
            .find(|item| item.id == second_run_id)
            .unwrap();
        assert_eq!(rejected_run.status, "rejected");
        assert_eq!(rejected_run.node_runs[1].status, "rejected");

        let deleted = service.delete_workflow("test").await.unwrap();
        assert!(deleted.workflows.is_empty());
        assert!(deleted.runs.is_empty());
        assert!(deleted.approvals.is_empty());
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn webhook_runs_require_an_enabled_webhook_workflow() {
        let root = test_root("webhook");
        let service = test_service(&root);
        let mut value = workflow(vec![AutomationEdge {
            id: "webhook-edge".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        }]);
        value.nodes[0].kind = "webhook_trigger".to_owned();
        value.nodes[1].config = json!({"message": "{{message}}"});
        service.save_workflow(value.clone()).await.unwrap();

        let disabled = service
            .run(AutomationRunRequest {
                workflow_id: "test".to_owned(),
                trigger: "webhook".to_owned(),
                input: json!({"message": "from webhook"}),
            })
            .await
            .unwrap_err();
        assert!(disabled.to_string().contains("disabled"));

        value.enabled = true;
        service.save_workflow(value).await.unwrap();
        let completed = service
            .run(AutomationRunRequest {
                workflow_id: "test".to_owned(),
                trigger: "webhook".to_owned(),
                input: json!({"message": "from webhook"}),
            })
            .await
            .unwrap();
        assert_eq!(completed.runs[0].status, "completed");
        assert_eq!(
            completed.runs[0].node_runs[1].output["message"],
            "from webhook"
        );
        let response = run_webhook(
            AxumPath("test".to_owned()),
            State(service.clone()),
            Json(json!({"message": "from route"})),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(response["accepted"], true);
        assert_eq!(response["status"], "completed");
        assert!(response.get("workflows").is_none());
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn scheduler_claims_each_due_interval_once() {
        let root = test_root("schedule-claim");
        let service = test_service(&root);
        let mut value = workflow(vec![AutomationEdge {
            id: "schedule-edge".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        }]);
        value.nodes[0].kind = "schedule_trigger".to_owned();
        value.enabled = true;
        value.interval_minutes = Some(15);
        service.save_workflow(value).await.unwrap();
        let mut before_claim = service.snapshot().await.unwrap();
        let mut stale_editor_copy = before_claim.workflows.remove(0);

        assert_eq!(service.claim_due_schedules().await.unwrap(), vec!["test"]);
        assert!(service.claim_due_schedules().await.unwrap().is_empty());
        let snapshot = service.snapshot().await.unwrap();
        assert!(snapshot.workflows[0].last_scheduled_at.is_some());
        stale_editor_copy.name = "Edited after schedule".to_owned();
        stale_editor_copy.last_scheduled_at = None;
        let saved_after_claim = service.save_workflow(stale_editor_copy).await.unwrap();
        assert!(saved_after_claim.workflows[0].last_scheduled_at.is_some());
        assert!(service.claim_due_schedules().await.unwrap().is_empty());
        let completed = service
            .run(AutomationRunRequest {
                workflow_id: "test".to_owned(),
                trigger: "schedule".to_owned(),
                input: Value::Null,
            })
            .await
            .unwrap();
        assert_eq!(completed.runs[0].status, "completed");
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn http_error_responses_fail_the_run_with_a_bounded_message() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/",
            get(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "request failed") }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let root = test_root("http-error");
        let service = test_service(&root);
        let mut value = workflow(vec![AutomationEdge {
            id: "http-edge".to_owned(),
            source: "a".to_owned(),
            target: "b".to_owned(),
        }]);
        value.nodes[1].kind = "http_request".to_owned();
        value.nodes[1].config = json!({"method": "GET", "url": format!("http://{address}/")});
        service.save_workflow(value).await.unwrap();

        let failed = service
            .run(AutomationRunRequest {
                workflow_id: "test".to_owned(),
                trigger: "manual".to_owned(),
                input: Value::Null,
            })
            .await
            .unwrap();
        assert_eq!(failed.runs[0].status, "failed");
        assert!(failed.runs[0]
            .error
            .as_deref()
            .unwrap()
            .contains("status 500: request failed"));

        server.abort();
        fs::remove_dir_all(root).await.unwrap();
    }
}
