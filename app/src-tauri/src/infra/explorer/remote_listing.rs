use super::*;

impl ExplorerService {
    pub(super) async fn list_virtual_directory(
        &self,
        path: &Path,
        show_hidden: bool,
        force_remote_refresh: bool,
    ) -> ApiResult<DirectoryListing> {
        let parts = virtual_path_parts(&self.mount_root, path).ok_or_else(|| {
            ApiError::Message(format!("Invalid remote mount path: {}", path.display()))
        })?;
        let mut remotes = self.remote_inventory().await?;

        match parts.len() {
            0 => Ok(self.remote_root_listing(remotes, show_hidden)),
            _ => {
                let mut target = RemoteBrowseTarget::from_virtual_path(&self.mount_root, path)
                    .ok_or_else(|| ApiError::Message("Invalid remote browse path".to_string()))?;
                let mut remote = remotes
                    .iter()
                    .find(|remote| remote.name == target.remote_name)
                    .cloned();
                if remote.is_none() {
                    remotes = self.providers.refresh().await?.remotes;
                    remote = remotes
                        .iter()
                        .find(|remote| remote.name == target.remote_name)
                        .cloned();
                }
                let Some(remote) = remote else {
                    return Err(ApiError::Message(format!(
                        "Remote \"{}\" was not found.",
                        target.remote_name
                    )));
                };
                target.provider_type = remote.provider_type.clone();
                self.remote_listing(target, show_hidden, force_remote_refresh)
                    .await
            }
        }
    }

    pub(super) async fn remote_inventory(&self) -> ApiResult<Vec<ProviderRemote>> {
        for _ in 0..REMOTE_INVENTORY_WAIT_ATTEMPTS {
            let snapshot = self.providers.snapshot().await?;
            if !snapshot.remotes.is_empty() {
                return Ok(snapshot.remotes);
            }
            if !snapshot.loading {
                break;
            }
            tokio::time::sleep(REMOTE_INVENTORY_WAIT_INTERVAL).await;
        }
        Ok(self.providers.refresh().await?.remotes)
    }

    pub(super) fn remote_root_listing(
        &self,
        mut remotes: Vec<ProviderRemote>,
        show_hidden: bool,
    ) -> DirectoryListing {
        remotes.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        let hidden_count = remotes
            .iter()
            .filter(|remote| remote.name.starts_with('.'))
            .count();
        let entries = remotes
            .into_iter()
            .filter(|remote| show_hidden || !remote.name.starts_with('.'))
            .map(|remote| {
                virtual_folder_entry(
                    self.mount_root.join(&remote.name),
                    remote.name.clone(),
                    ExplorerLocation {
                        kind: ExplorerLocationKind::Remote,
                        provider_type: Some(remote.provider_type),
                        remote_name: Some(remote.name),
                        remote_path: Some("/".to_string()),
                    },
                )
            })
            .collect::<Vec<_>>();
        DirectoryListing {
            path: display_path(&self.mount_root),
            title: None,
            parent_path: self.mount_root.parent().map(display_path),
            location: ExplorerLocation {
                kind: ExplorerLocationKind::RemoteProvider,
                provider_type: None,
                remote_name: None,
                remote_path: None,
            },
            total_count: entries.len() + hidden_count,
            hidden_count,
            entries,
            modified_ms: None,
            created_ms: None,
        }
    }

    pub(super) async fn remote_listing(
        &self,
        target: RemoteBrowseTarget,
        show_hidden: bool,
        _force_remote_refresh: bool,
    ) -> ApiResult<DirectoryListing> {
        // The backend is the source of truth. Files already materialized below the
        // virtual mount are reusable by their fetched name, while the serialized
        // listing is only an offline/error fallback.
        let items = match self.fetch_remote_items(&target).await {
            Ok(items) => items,
            Err(remote_error) if is_remote_directory_not_found_error(&remote_error) => {
                let _ = self
                    .listing_cache
                    .clear(&target.remote_name, &target.remote_path)
                    .await;
                return Err(remote_error);
            }
            Err(remote_error) => match self.load_cached_remote_items(&target).await? {
                Some(items) => items,
                None => return Err(remote_error),
            },
        };
        self.remote_listing_from_items(target, show_hidden, items)
    }

    pub(super) async fn load_cached_remote_items(
        &self,
        target: &RemoteBrowseTarget,
    ) -> ApiResult<Option<Vec<RemoteListItem>>> {
        let Some(body) = self
            .listing_cache
            .load(&target.remote_name, &target.remote_path)
            .await?
        else {
            return Ok(None);
        };
        match serde_json::from_slice::<Vec<RemoteListItem>>(&body) {
            Ok(items) => Ok(Some(items)),
            Err(_) => Ok(None),
        }
    }

    pub(super) fn remote_listing_from_items(
        &self,
        target: RemoteBrowseTarget,
        show_hidden: bool,
        mut items: Vec<RemoteListItem>,
    ) -> ApiResult<DirectoryListing> {
        items.sort_by(|left, right| {
            (!left.is_dir)
                .cmp(&(!right.is_dir))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        let items = dedupe_remote_list_items(&target, items)?;

        let hidden_count = items
            .iter()
            .filter(|item| item.name.starts_with('.'))
            .count();
        let total_count = items.len();
        let mut entries = Vec::with_capacity(items.len());
        for item in items {
            if !show_hidden && item.name.starts_with('.') {
                continue;
            }
            let remote_path = remote_item_path(&target, &item)?;
            let item_target = RemoteBrowseTarget {
                provider_type: target.provider_type.clone(),
                remote_name: target.remote_name.clone(),
                remote_path: remote_path.clone(),
            };
            let virtual_path = item_target.virtual_path(&self.mount_root);
            let name = if item.name.is_empty() {
                Path::new(&remote_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(&remote_path)
                    .to_string()
            } else {
                item.name
            };
            entries.push(FileEntry {
                id: display_path(&virtual_path),
                extension: Path::new(&name)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string(),
                mime_type: (!item.mime_type.is_empty()).then_some(item.mime_type),
                remote_modified: (!item.mod_time.is_empty()).then_some(item.mod_time),
                hidden: name.starts_with('.'),
                name,
                path: display_path(&virtual_path),
                kind: if item.is_dir {
                    FileKind::Folder
                } else {
                    FileKind::File
                },
                size_bytes: if item.is_dir {
                    None
                } else {
                    Some(item.size.max(0) as u64)
                },
                modified_ms: None,
                created_ms: None,
                readonly: false,
                is_deleted: false,
                location: ExplorerLocation {
                    kind: ExplorerLocationKind::Remote,
                    provider_type: Some(target.provider_type.clone()),
                    remote_name: Some(target.remote_name.clone()),
                    remote_path: Some(remote_path),
                },
            });
        }

        let listing_path = target.virtual_path(&self.mount_root);
        let parent_path = listing_path.parent().map(display_path);
        Ok(DirectoryListing {
            path: display_path(&listing_path),
            title: None,
            parent_path,
            location: ExplorerLocation {
                kind: ExplorerLocationKind::Remote,
                provider_type: Some(target.provider_type),
                remote_name: Some(target.remote_name),
                remote_path: Some(target.remote_path),
            },
            entries,
            total_count,
            hidden_count,
            modified_ms: None,
            created_ms: None,
        })
    }
}
