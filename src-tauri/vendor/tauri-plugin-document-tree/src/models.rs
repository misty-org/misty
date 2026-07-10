use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTreeLocation {
    pub uri: String,
    pub name: String,
    pub document_id: String,
    pub can_write: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PickTreeRequest {
    pub initial_directory: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllFilesAccessStatus {
    pub granted: bool,
    pub can_request: bool,
    pub storage_root: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTreeLocationsResponse {
    pub trees: Vec<DocumentTreeLocation>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListChildrenRequest {
    pub tree_uri: String,
    pub document_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTreeEntry {
    pub document_id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub is_directory: bool,
    pub size_bytes: Option<u64>,
    pub modified_ms: Option<i64>,
    pub can_write: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListChildrenResponse {
    pub entries: Vec<DocumentTreeEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseTreeRequest {
    pub uri: String,
}
