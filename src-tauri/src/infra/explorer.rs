//! The read-only folder listing behind Misty's file picker. Managing files
//! happens in Kura, a separate app.
use std::path::PathBuf;

use crate::domain::explorer::{list_directory, DirectoryListing, ListDirectoryRequest};
use crate::error::{ApiError, ApiResult};
use crate::infra::environment::AppEnvironmentService;

#[derive(Clone)]
pub struct ExplorerService {
    home_dir: PathBuf,
}

impl ExplorerService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            home_dir: environment.home_dir(),
        }
    }

    pub async fn list_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> ApiResult<DirectoryListing> {
        if let Some(path) = request
            .path
            .as_deref()
            .map(str::trim)
            .filter(|path| path.starts_with("misty://"))
        {
            return Err(ApiError::Message(format!(
                "Unsupported virtual Explorer location: {path}"
            )));
        }
        let home_dir = self.home_dir.clone();
        tokio::task::spawn_blocking(move || list_directory(home_dir, request))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer worker failed: {err}")))?
    }
}
