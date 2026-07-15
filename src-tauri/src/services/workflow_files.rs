use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs;
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    services::environment::AppEnvironmentService,
};

const MF_FORMAT: &str = "misty.workflow";
const MF_VERSION: u32 = 1;
const MAX_MF_BYTES: u64 = 5 * 1024 * 1024;

fn empty_object() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfWorkflowDocument {
    pub format: String,
    pub format_version: u32,
    pub id: String,
    pub revision: u64,
    pub profile: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub nodes: Vec<MfWorkflowNode>,
    #[serde(default)]
    pub edges: Vec<MfWorkflowEdge>,
    #[serde(default = "empty_object")]
    pub settings: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfWorkflowNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub position: MfWorkflowPosition,
    #[serde(default = "empty_object")]
    pub config: Value,
    #[serde(default)]
    pub policy: Vec<MfWorkflowPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfWorkflowPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfWorkflowPolicy {
    pub capability: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfWorkflowEdge {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfWorkflowFile {
    pub path: String,
    pub document: MfWorkflowDocument,
}

pub async fn write_mf(
    environment: &AppEnvironmentService,
    document: MfWorkflowDocument,
) -> ApiResult<MfWorkflowFile> {
    validate_mf(&document)?;
    let config_dir = environment.config_dir();
    let directory = config_dir
        .parent()
        .unwrap_or(config_dir.as_path())
        .join("workflows");
    fs::create_dir_all(&directory)
        .await
        .map_err(io_error(&directory))?;
    let path = unique_workflow_path(&directory, &document.name, &document.id).await;
    let temporary = path.with_extension(format!("mf.{}.tmp", Uuid::new_v4()));
    let body = serde_json::to_vec_pretty(&document)?;
    fs::write(&temporary, body)
        .await
        .map_err(io_error(&temporary))?;
    fs::rename(&temporary, &path)
        .await
        .map_err(io_error(&path))?;
    Ok(MfWorkflowFile {
        path: display_path(&path),
        document,
    })
}

pub async fn read_mf(path: &str) -> ApiResult<MfWorkflowFile> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|value| value.to_str()) != Some("mf") {
        return Err(ApiError::Message(
            "Misty workflow files must use the .mf extension.".to_owned(),
        ));
    }
    let metadata = fs::metadata(&path).await.map_err(io_error(&path))?;
    if !metadata.is_file() || metadata.len() > MAX_MF_BYTES {
        return Err(ApiError::Message(
            "The selected .mf file is invalid or larger than 5 MB.".to_owned(),
        ));
    }
    let body = fs::read(&path).await.map_err(io_error(&path))?;
    let document: MfWorkflowDocument = serde_json::from_slice(&body)
        .map_err(|error| ApiError::Message(format!("Invalid .mf file: {error}")))?;
    validate_mf(&document)?;
    Ok(MfWorkflowFile {
        path: display_path(&path),
        document,
    })
}

pub fn validate_mf(document: &MfWorkflowDocument) -> ApiResult<()> {
    if document.format != MF_FORMAT || document.format_version != MF_VERSION {
        return Err(ApiError::Message(
            "Unsupported Misty workflow format.".to_owned(),
        ));
    }
    if !matches!(
        document.profile.as_str(),
        "automation" | "agent" | "universal"
    ) {
        return Err(ApiError::Message(
            "The .mf execution profile is invalid.".to_owned(),
        ));
    }
    if document.id.trim().is_empty() || document.name.trim().is_empty() {
        return Err(ApiError::Message(
            "The .mf workflow needs an id and name.".to_owned(),
        ));
    }
    if document.name.chars().count() > 200 || document.description.chars().count() > 20_000 {
        return Err(ApiError::Message(
            "The .mf workflow metadata is too large.".to_owned(),
        ));
    }
    if document.nodes.len() > 1_000 || document.edges.len() > 5_000 {
        return Err(ApiError::Message(
            "The .mf workflow graph is too large.".to_owned(),
        ));
    }
    if !document.settings.is_object() {
        return Err(ApiError::Message(
            "The .mf settings value must be an object.".to_owned(),
        ));
    }
    let mut node_ids = HashSet::new();
    for node in &document.nodes {
        if node.id.trim().is_empty()
            || node.kind.trim().is_empty()
            || !node_ids.insert(node.id.as_str())
        {
            return Err(ApiError::Message(
                "The .mf workflow contains an empty or duplicate node id.".to_owned(),
            ));
        }
        if !node.config.is_object() {
            return Err(ApiError::Message(
                "Every .mf node config must be an object.".to_owned(),
            ));
        }
        if node.policy.iter().any(|policy| {
            policy.capability.trim().is_empty()
                || !matches!(policy.mode.as_str(), "automatic" | "approval")
        }) {
            return Err(ApiError::Message(
                "The .mf workflow contains an invalid node policy.".to_owned(),
            ));
        }
    }
    let mut edge_ids = HashSet::new();
    let mut degree: HashMap<&str, usize> = node_ids.iter().map(|id| (*id, 0)).collect();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in &document.edges {
        if edge.id.trim().is_empty() || !edge_ids.insert(edge.id.as_str()) {
            return Err(ApiError::Message(
                "The .mf workflow contains an empty or duplicate edge id.".to_owned(),
            ));
        }
        if !node_ids.contains(edge.source.as_str())
            || !node_ids.contains(edge.target.as_str())
            || edge.source == edge.target
        {
            return Err(ApiError::Message(format!(
                "The .mf edge {} is invalid.",
                edge.id
            )));
        }
        *degree.get_mut(edge.target.as_str()).expect("known target") += 1;
        outgoing
            .entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
    }
    let mut queue: Vec<&str> = degree
        .iter()
        .filter_map(|(id, value)| (*value == 0).then_some(*id))
        .collect();
    let mut visited = 0;
    while let Some(id) = queue.pop() {
        visited += 1;
        for target in outgoing.get(id).into_iter().flatten() {
            let value = degree.get_mut(target).expect("known target");
            *value -= 1;
            if *value == 0 {
                queue.push(target);
            }
        }
    }
    if visited != node_ids.len() {
        return Err(ApiError::Message(
            "The .mf workflow contains a cycle.".to_owned(),
        ));
    }
    Ok(())
}

async fn unique_workflow_path(directory: &Path, name: &str, id: &str) -> PathBuf {
    let slug = slug(name);
    let id = id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>();
    let base = if id.is_empty() {
        slug
    } else {
        format!("{slug}-{id}")
    };
    let mut candidate = directory.join(format!("{base}.mf"));
    let mut suffix = 2;
    while fs::try_exists(&candidate).await.unwrap_or(false) {
        candidate = directory.join(format!("{base}-{suffix}.mf"));
        suffix += 1;
    }
    candidate
}

fn slug(value: &str) -> String {
    let normalized = value.trim().to_lowercase();
    let mut result = String::new();
    let mut separator = false;
    for character in normalized.chars() {
        if character.is_ascii_alphanumeric() {
            result.push(character);
            separator = false;
        } else if !separator && !result.is_empty() {
            result.push('-');
            separator = true;
        }
    }
    let result = result.trim_matches('-');
    if result.is_empty() {
        "workflow".to_owned()
    } else {
        result.to_owned()
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn io_error(path: &Path) -> impl Fn(std::io::Error) -> ApiError + '_ {
    move |error| ApiError::Message(format!("Failed to access {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> MfWorkflowDocument {
        MfWorkflowDocument {
            format: MF_FORMAT.to_owned(),
            format_version: 1,
            id: "workflow-1".to_owned(),
            revision: 1,
            profile: "universal".to_owned(),
            name: "Morning Brief".to_owned(),
            description: String::new(),
            nodes: vec![MfWorkflowNode {
                id: "manual".to_owned(),
                kind: "manual_trigger".to_owned(),
                label: "Manual".to_owned(),
                position: MfWorkflowPosition { x: 0.0, y: 0.0 },
                config: Value::Object(Default::default()),
                policy: Vec::new(),
            }],
            edges: Vec::new(),
            settings: Value::Object(Default::default()),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn validates_mf_document_and_rejects_cycles() {
        assert!(validate_mf(&document()).is_ok());
        let mut value = document();
        value.nodes.push(MfWorkflowNode {
            id: "task".to_owned(),
            kind: "notify".to_owned(),
            label: "Task".to_owned(),
            position: MfWorkflowPosition { x: 1.0, y: 1.0 },
            config: Value::Object(Default::default()),
            policy: Vec::new(),
        });
        value.edges = vec![
            MfWorkflowEdge {
                id: "a".to_owned(),
                source: "manual".to_owned(),
                target: "task".to_owned(),
            },
            MfWorkflowEdge {
                id: "b".to_owned(),
                source: "task".to_owned(),
                target: "manual".to_owned(),
            },
        ];
        assert!(validate_mf(&value)
            .unwrap_err()
            .to_string()
            .contains("cycle"));
    }

    #[tokio::test]
    async fn writes_and_reads_mf_files() {
        let root = std::env::temp_dir().join(format!("misty-mf-{}", Uuid::new_v4()));
        let environment = AppEnvironmentService::new_with_data_root(Some(root.clone()));
        let written = write_mf(&environment, document()).await.unwrap();
        assert!(written.path.ends_with(".mf"));
        let loaded = read_mf(&written.path).await.unwrap();
        assert_eq!(loaded.document.id, "workflow-1");
        assert_eq!(loaded.document.format, MF_FORMAT);
        fs::remove_dir_all(root).await.unwrap();
    }
}
