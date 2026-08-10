use super::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibraryImportPreflight {
    pub paths: Vec<String>,
    pub file_names: Vec<String>,
    pub eligible_paths: Vec<String>,
    pub skipped_files: Vec<SkippedLibraryImportFile>,
    pub eligible_files: usize,
    pub unsupported_files: usize,
    pub estimate: AnalysisEstimate,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedLibraryImportFile {
    pub path: String,
    pub reason: String,
}

impl SmartLibraryService {
    pub async fn import_files(
        &self,
        request: SmartLibraryImportFilesRequest,
    ) -> ApiResult<SmartLibraryImportResult> {
        validate_request(&request)?;
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            let hints = load_scan_hints(&db_path)?;
            let discovered = discover_selected_local(&request.paths, &hints)?;
            persist_imported_files(&db_path, discovered)
        })
        .await
        .map_err(worker_error)?
    }

    pub async fn preflight_import(
        &self,
        request: SmartLibraryImportFilesRequest,
    ) -> ApiResult<SmartLibraryImportPreflight> {
        validate_request(&request)?;
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            let hints = load_scan_hints(&db_path)?;
            let discovered = discover_selected_local(&request.paths, &hints)?;
            Ok(build_preflight(discovered))
        })
        .await
        .map_err(worker_error)?
    }
}

fn build_preflight(discovered: Vec<DiscoveredAsset>) -> SmartLibraryImportPreflight {
    let eligible_paths = discovered
        .iter()
        .filter(|asset| asset.preview_supported)
        .map(|asset| asset.path.clone())
        .collect::<Vec<_>>();
    let skipped_files = discovered
        .iter()
        .filter(|asset| !asset.preview_supported)
        .map(|asset| SkippedLibraryImportFile {
            path: asset.path.clone(),
            reason: asset
                .unsupported_reason
                .clone()
                .unwrap_or_else(|| "Unsupported file".to_owned()),
        })
        .collect::<Vec<_>>();
    let eligible_files = eligible_paths.len();
    let unsupported_files = discovered.len().saturating_sub(eligible_files);
    let included_files = PILOT_SAMPLE_SIZE.min(eligible_files);
    SmartLibraryImportPreflight {
        paths: eligible_paths.clone(),
        file_names: discovered.iter().map(|asset| asset.name.clone()).collect(),
        eligible_paths,
        skipped_files,
        eligible_files,
        unsupported_files,
        estimate: AnalysisEstimate {
            eligible_images: eligible_files,
            included_images: included_files,
            billable_images: eligible_files.saturating_sub(included_files),
            credit_units: eligible_files.saturating_sub(included_files),
            price_minor: None,
            currency: None,
        },
    }
}

fn validate_request(request: &SmartLibraryImportFilesRequest) -> ApiResult<()> {
    if request.paths.is_empty() {
        return Err(ApiError::Message(
            "Choose at least one file to add to Library.".to_owned(),
        ));
    }
    if request.paths.len() > MAX_MANUAL_IMPORT_FILES {
        return Err(ApiError::Message(format!(
            "Add at most {MAX_MANUAL_IMPORT_FILES} files at once."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preflight_is_file_only_limited_and_non_mutating() {
        let root = std::env::temp_dir().join(format!("misty-library-preflight-{}", Uuid::new_v4()));
        let file = root.join("photo.jpg");
        let database = root.join("library.sqlite3");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&file, b"image").unwrap();

        let hints = load_scan_hints(&database).unwrap();
        let discovered = discover_selected_local(&[file.display().to_string()], &hints).unwrap();
        let result = build_preflight(discovered);
        assert_eq!(result.eligible_paths, vec![file.display().to_string()]);
        assert!(!database.exists());
        assert!(discover_selected_local(&[root.display().to_string()], &hints).is_err());
        assert!(validate_request(&SmartLibraryImportFilesRequest {
            paths: vec!["x".into(); 501]
        })
        .is_err());

        let _ = std::fs::remove_dir_all(root);
    }
}
