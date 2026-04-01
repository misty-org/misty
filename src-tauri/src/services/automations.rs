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
                http: reqwest::Client::new(),
                webhook_url: format!("http://127.0.0.1:{port}"),
            }),
        };
        service.start_webhook_server(port);
        service
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
        drop(_guard);
        self.snapshot().await
    }

    pub fn validate(&self, workflow: &AutomationWorkflow) -> AutomationValidation {
        validate_workflow(workflow)
    }

    pub async fn run(&self, request: AutomationRunRequest) -> ApiResult<AutomationSnapshot> {
        let workflows = load_json::<WorkflowStore>(&self.inner.workflows_path).await?;
        let workflow = workflows
            .workflows
            .into_iter()
            .find(|item| item.id == request.workflow_id)
            .ok_or_else(|| ApiError::Message("Automation workflow was not found.".to_owned()))?;
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
        approval.status = if approved { "approved" } else { "rejected" }.to_owned();
        approval.resolved_at = Some(Utc::now().to_rfc3339());
        let run_id = approval.run_id.clone();
        let pending = store
            .approvals
            .iter()
            .any(|item| item.run_id == run_id && item.status == "pending");
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
                let cwd = node
                    .config
                    .get("cwd")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty());
                let text = self.inner.ai.complete(&prompt, cwd).await?;
                Ok(json!({ "text": text, "value": text, "prompt": prompt }))
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
        Ok(json!({ "status": status, "body": text, "value": text, "url": url }))
    }
}

async fn run_webhook(
    AxumPath(workflow_id): AxumPath<String>,
    State(service): State<AutomationService>,
    Json(input): Json<Value>,
) -> Result<Json<AutomationSnapshot>, (StatusCode, String)> {
    service
        .run(AutomationRunRequest {
            workflow_id,
            trigger: "webhook".to_owned(),
            input,
        })
        .await
        .map(Json)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))
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
    let ids: HashSet<&str> = workflow.nodes.iter().map(|node| node.id.as_str()).collect();
    if ids.len() != workflow.nodes.len() {
        errors.push("Node IDs must be unique.".to_owned());
    }
    for edge in &workflow.edges {
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
    if workflow.enabled
        && workflow.interval_minutes.is_some()
        && !workflow
            .nodes
            .iter()
            .any(|node| node.kind == "schedule_trigger")
    {
        errors.push("An enabled schedule needs a Schedule trigger node.".to_owned());
    }
    AutomationValidation {
        valid: errors.is_empty(),
        errors,
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
    let mut queue: VecDeque<String> = degree
        .iter()
        .filter(|(_, value)| **value == 0)
        .map(|(id, _)| id.clone())
        .collect();
    let mut order = Vec::new();
    while let Some(id) = queue.pop_front() {
        order.push(id.clone());
        for target in outgoing.get(&id).into_iter().flatten() {
            if let Some(value) = degree.get_mut(target) {
                *value -= 1;
                if *value == 0 {
                    queue.push_back(target.clone());
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
    fs::rename(temporary, path).await.map_err(io_error)
}

fn io_error(error: std::io::Error) -> ApiError {
    ApiError::Message(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
