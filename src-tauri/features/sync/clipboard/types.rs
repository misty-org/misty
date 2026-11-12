/// A file reference the clipboard copies.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteItem {
    pub path: String,
    pub is_directory: bool,
    #[serde(default)]
    pub size_bytes: Option<i64>,
    #[serde(default)]
    pub remote_modified: Option<String>,
}
