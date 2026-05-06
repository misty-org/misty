use super::*;

impl ExplorerService {
    pub async fn list_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> ApiResult<DirectoryListing> {
        if let Some(path) = request.path.as_deref().map(str::trim) {
            if path == VIRTUAL_PATH_RECENT || path == VIRTUAL_PATH_STARRED {
                return self.list_library_virtual_directory(path).await;
            }
            if path == VIRTUAL_PATH_LIBRARY {
                return Ok(DirectoryListing {
                    path: path.to_owned(),
                    title: Some("Library".to_owned()),
                    parent_path: None,
                    location: ExplorerLocation::local(),
                    hidden_count: 0,
                    total_count: 0,
                    entries: Vec::new(),
                    modified_ms: None,
                    created_ms: None,
                });
            }
            if path == VIRTUAL_PATH_TRASH {
                return self.list_trash_virtual_directory().await;
            }
            if path.starts_with("misty://") {
                return Err(ApiError::Message(format!(
                    "Unsupported virtual Explorer location: {path}"
                )));
            }
        }

        let requested = request
            .path
            .as_deref()
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.home_dir.clone());

        if requested == self.mount_root || requested.starts_with(&self.mount_root) {
            return self
                .list_virtual_directory(
                    &requested,
                    request.show_hidden.unwrap_or(false),
                    request.force_remote_refresh.unwrap_or(false),
                )
                .await;
        }

        let home_dir = self.home_dir.clone();
        tokio::task::spawn_blocking(move || list_directory(home_dir, request))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer worker failed: {err}")))?
    }

    #[cfg(target_os = "android")]
    pub fn is_android_local_virtual_path(&self, path: Option<&str>) -> bool {
        path.map(|value| value.trim().is_empty() || value.starts_with(VIRTUAL_PATH_LOCAL))
            .unwrap_or(true)
    }

    #[cfg(target_os = "android")]
    pub async fn list_android_local_directory(
        &self,
        app: &AppHandle,
        request: ListDirectoryRequest,
    ) -> ApiResult<DirectoryListing> {
        let path = request
            .path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(VIRTUAL_PATH_LOCAL);
        let locations = app.document_tree().persisted_trees().map_err(|error| {
            ApiError::Message(format!("Could not read granted folders: {error}"))
        })?;

        if path == VIRTUAL_PATH_LOCAL {
            let entries = locations
                .iter()
                .map(|location| android_local_location_entry(location))
                .collect::<Vec<_>>();
            return Ok(DirectoryListing {
                path: VIRTUAL_PATH_LOCAL.to_owned(),
                title: Some("Local".to_owned()),
                parent_path: None,
                location: ExplorerLocation::local(),
                hidden_count: 0,
                total_count: entries.len(),
                entries,
                modified_ms: None,
                created_ms: None,
            });
        }

        let (location_id, document_id) = parse_android_local_path(path)?;
        let location = locations
            .iter()
            .find(|location| android_local_location_id(&location.uri) == location_id)
            .ok_or_else(|| {
                ApiError::Message(
                    "This Android folder permission is no longer available.".to_owned(),
                )
            })?;
        let entries = app
            .document_tree()
            .list_children(ListChildrenRequest {
                tree_uri: location.uri.clone(),
                document_id: document_id.clone(),
            })
            .map_err(|error| {
                ApiError::Message(format!("Could not list the selected folder: {error}"))
            })?
            .into_iter()
            .map(|entry| {
                let entry_path = android_local_child_path(path, &entry.document_id);
                let name = entry.name;
                FileEntry {
                    id: entry_path.clone(),
                    path: entry_path,
                    extension: Path::new(&name)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_owned(),
                    mime_type: entry.mime_type,
                    remote_modified: None,
                    kind: if entry.is_directory {
                        FileKind::Folder
                    } else {
                        FileKind::File
                    },
                    size_bytes: entry.size_bytes,
                    modified_ms: entry.modified_ms,
                    created_ms: None,
                    readonly: !entry.can_write,
                    hidden: name.starts_with('.'),
                    is_deleted: false,
                    location: ExplorerLocation::local(),
                    name,
                }
            })
            .collect::<Vec<_>>();
        let parent_path = if document_id.is_some() {
            path.rsplit_once('/').map(|(parent, _)| parent.to_owned())
        } else {
            Some(VIRTUAL_PATH_LOCAL.to_owned())
        };
        Ok(DirectoryListing {
            path: path.to_owned(),
            title: Some(location.name.clone()),
            parent_path,
            location: ExplorerLocation::local(),
            hidden_count: 0,
            total_count: entries.len(),
            entries,
            modified_ms: None,
            created_ms: None,
        })
    }

    pub(super) async fn list_library_virtual_directory(
        &self,
        path: &str,
    ) -> ApiResult<DirectoryListing> {
        let snapshot = self.explorer_library.snapshot().await?;
        let source_items = if path == VIRTUAL_PATH_RECENT {
            snapshot.recent_files
        } else {
            snapshot.starred_files
        };
        let mut entries: Vec<FileEntry> = source_items
            .into_iter()
            .filter_map(|item| self.library_item_to_file_entry(item, path == VIRTUAL_PATH_RECENT))
            .collect();
        entries.sort_by(|left, right| {
            virtual_folder_rank(&left.kind)
                .cmp(&virtual_folder_rank(&right.kind))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        let total_count = entries.len();
        Ok(DirectoryListing {
            path: path.to_string(),
            title: None,
            parent_path: None,
            location: ExplorerLocation::local(),
            hidden_count: 0,
            total_count,
            entries,
            modified_ms: None,
            created_ms: None,
        })
    }

    pub(super) async fn list_trash_virtual_directory(&self) -> ApiResult<DirectoryListing> {
        let trash_dir = self.trash_dir.clone();
        let entries = tokio::task::spawn_blocking(move || trash_virtual_entries(&trash_dir))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer trash worker failed: {err}")))??;
        let total_count = entries.len();
        Ok(DirectoryListing {
            path: VIRTUAL_PATH_TRASH.to_string(),
            title: Some("Trash".to_owned()),
            parent_path: None,
            location: ExplorerLocation::local(),
            hidden_count: 0,
            total_count,
            entries,
            modified_ms: None,
            created_ms: None,
        })
    }

    pub(super) fn library_item_to_file_entry(
        &self,
        item: ExplorerLibraryItem,
        prune_missing_local: bool,
    ) -> Option<FileEntry> {
        let path = item.path.trim();
        if path.is_empty() {
            return None;
        }
        if self.remote_target(path).is_none() && prune_missing_local && !Path::new(path).exists() {
            return None;
        }
        let path_buf = PathBuf::from(path);
        let name = if item.name.trim().is_empty() {
            path_buf
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(path)
                .to_string()
        } else {
            item.name
        };
        let kind = if item.is_dir {
            FileKind::Folder
        } else {
            FileKind::File
        };
        let location = self
            .remote_target(path)
            .map(|target| ExplorerLocation {
                kind: ExplorerLocationKind::Remote,
                provider_type: Some(target.provider_type),
                remote_name: Some(target.remote_name),
                remote_path: Some(target.remote_path),
                ..Default::default()
            })
            .unwrap_or_else(ExplorerLocation::local);
        let size_bytes = if item.size > 0 && !item.is_dir {
            Some(item.size as u64)
        } else {
            None
        };
        let mime_type = if item.mime_type.trim().is_empty() {
            None
        } else {
            Some(item.mime_type)
        };
        let remote_modified = if item.last_modified.trim().is_empty() {
            None
        } else {
            Some(item.last_modified)
        };
        Some(FileEntry {
            id: if item.id.trim().is_empty() {
                path.to_string()
            } else {
                item.id
            },
            name,
            path: path.to_string(),
            extension: path_buf
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            mime_type,
            remote_modified,
            kind,
            size_bytes,
            modified_ms: None,
            created_ms: None,
            readonly: false,
            hidden: path_buf
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.starts_with('.'))
                .unwrap_or(false),
            is_deleted: false,
            location,
        })
    }

    pub async fn item_is_directory(&self, path: &str) -> ApiResult<Option<bool>> {
        if let Some(target) = self.remote_target(path) {
            if target.remote_path == "/" {
                return Ok(Some(true));
            }
            let parent = RemoteBrowseTarget {
                provider_type: target.provider_type.clone(),
                remote_name: target.remote_name.clone(),
                remote_path: remote_parent_path(&target.remote_path),
            };
            let items = match self.fetch_remote_items(&parent).await {
                Ok(items) => items,
                Err(error) if is_remote_directory_not_found_error(&error) => return Ok(None),
                Err(error) => return Err(error),
            };
            return remote_item_is_directory(&parent, &target.remote_path, &items);
        }
        self.reject_virtual_mount_container(path, "inspect")?;
        // Match std::filesystem::is_directory in the native Explorer: the
        // decision to browse or open follows a local symlink's target.
        match tokio::fs::metadata(path).await {
            Ok(metadata) => Ok(Some(metadata.is_dir())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(ApiError::Message(format!(
                "Failed to inspect {path}: {error}"
            ))),
        }
    }
}
