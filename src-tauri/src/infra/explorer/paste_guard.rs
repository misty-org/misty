use super::*;

impl ExplorerService {
    pub(super) fn validate_paste_paths(&self, request: &PasteItemsRequest) -> ApiResult<()> {
        self.reject_virtual_mount_container(&request.destination_directory, "paste")?;
        for source in &request.sources {
            self.reject_virtual_mount_container(&source.path, "copy")?;
        }
        Ok(())
    }

    pub(super) fn reject_virtual_mount_container(
        &self,
        path: &str,
        operation: &str,
    ) -> ApiResult<()> {
        if path.contains("://") {
            return Err(ApiError::Message(
                "Choose a local folder or LAN device.".into(),
            ));
        }
        let path = Path::new(path);
        if path == self.mount_root || path.starts_with(&self.mount_root) {
            return Err(ApiError::Message(format!(
                "Cloud file locations are no longer supported. Choose a local folder or LAN device to {operation}."
            )));
        }
        Ok(())
    }
}
