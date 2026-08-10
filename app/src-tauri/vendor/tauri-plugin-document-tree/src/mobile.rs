use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{
    AllFilesAccessStatus, DocumentTreeEntry, DocumentTreeLocation, DocumentTreeLocationsResponse,
    ListChildrenRequest, ListChildrenResponse, PickTreeRequest, ReleaseTreeRequest, Result,
};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<DocumentTree<R>> {
    let handle = api.register_android_plugin("app.tauri.documenttree", "DocumentTreePlugin")?;
    Ok(DocumentTree(handle))
}

pub struct DocumentTree<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> DocumentTree<R> {
    pub fn pick_tree(&self, request: PickTreeRequest) -> Result<DocumentTreeLocation> {
        self.0
            .run_mobile_plugin("pickTree", request)
            .map_err(Into::into)
    }

    pub fn all_files_access_status(&self) -> Result<AllFilesAccessStatus> {
        self.0
            .run_mobile_plugin("allFilesAccessStatus", ())
            .map_err(Into::into)
    }

    pub fn open_all_files_access_settings(&self) -> Result<AllFilesAccessStatus> {
        self.0
            .run_mobile_plugin("openAllFilesAccessSettings", ())
            .map_err(Into::into)
    }

    pub fn persisted_trees(&self) -> Result<Vec<DocumentTreeLocation>> {
        let response: DocumentTreeLocationsResponse =
            self.0.run_mobile_plugin("persistedTrees", ())?;
        Ok(response.trees)
    }

    pub fn list_children(&self, request: ListChildrenRequest) -> Result<Vec<DocumentTreeEntry>> {
        let response: ListChildrenResponse = self.0.run_mobile_plugin("listChildren", request)?;
        Ok(response.entries)
    }

    pub fn release_tree(&self, uri: String) -> Result<()> {
        self.0
            .run_mobile_plugin("releaseTree", ReleaseTreeRequest { uri })
            .map_err(Into::into)
    }
}
