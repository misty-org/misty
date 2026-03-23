use std::{path::PathBuf, sync::Arc};

use tokio::sync::Mutex;

use crate::{
    core::workspace::{load_workspace_document, save_workspace_document, WorkspaceDocument},
    error::ApiResult,
    services::environment::AppEnvironmentService,
};

#[derive(Clone)]
pub struct WorkspaceService {
    inner: Arc<WorkspaceServiceInner>,
}

struct WorkspaceServiceInner {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl WorkspaceService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            inner: Arc::new(WorkspaceServiceInner {
                path: environment.workspaces_path(),
                write_lock: Mutex::new(()),
            }),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<WorkspaceDocument> {
        load_workspace_document(&self.inner.path).await
    }

    pub async fn save(&self, document: WorkspaceDocument) -> ApiResult<WorkspaceDocument> {
        let _guard = self.inner.write_lock.lock().await;
        save_workspace_document(&self.inner.path, &document).await?;
        Ok(document)
    }
}
