use super::*;
use crate::infra::document_intelligence::ServiceLease;
use std::io::Write;
#[path = "search_worker.rs"]
mod worker;
pub(crate) use worker::execute as execute_package_index;
#[derive(Clone)]
pub(super) struct Index {
    path: PathBuf,
    lease: Arc<ServiceLease>,
}
pub(super) struct IndexReader {
    index: Index,
    count: u64,
}
#[derive(Clone, Copy, Debug)]
pub(super) struct SearchIndexFields;
pub(super) struct IndexWriter {
    index: Index,
    mutations: Mutex<tempfile::NamedTempFile>,
}
impl Index {
    fn execute(
        &self,
        request: serde_json::Value,
        mutations: Option<&Path>,
    ) -> ApiResult<serde_json::Value> {
        worker::execute(&self.lease, &self.path, request, mutations).map_err(ApiError::Message)
    }
    pub(super) fn writer_with_num_threads(
        &self,
        _threads: usize,
        _budget: usize,
    ) -> ApiResult<IndexWriter> {
        Ok(IndexWriter {
            index: self.clone(),
            mutations: Mutex::new(
                tempfile::NamedTempFile::new().map_err(|e| ApiError::Message(e.to_string()))?,
            ),
        })
    }
}
impl IndexReader {
    pub(super) fn searcher(&self) -> &Self {
        self
    }
    pub(super) fn num_docs(&self) -> u64 {
        self.count
    }
}
impl IndexWriter {
    fn append(&self, value: serde_json::Value) -> ApiResult<()> {
        if self.index.lease.cancelled() {
            return Err(ApiError::Message("Files search access changed.".into()));
        }
        let mut file = self
            .mutations
            .lock()
            .map_err(|e| ApiError::Message(e.to_string()))?;
        serde_json::to_writer(file.as_file_mut(), &value)?;
        file.write_all(b"\n")
            .map_err(|e| ApiError::Message(e.to_string()))
    }
    pub(super) fn commit(&mut self) -> ApiResult<()> {
        let mut file = self
            .mutations
            .lock()
            .map_err(|e| ApiError::Message(e.to_string()))?;
        file.flush().map_err(|e| ApiError::Message(e.to_string()))?;
        self.index.execute(
            serde_json::json!({"protocol":1,"operation":"apply"}),
            Some(file.path()),
        )?;
        Ok(())
    }
}
pub(super) fn open(
    path: &Path,
    lease: Arc<ServiceLease>,
) -> ApiResult<(Index, IndexReader, SearchIndexFields)> {
    let index = Index {
        path: path.into(),
        lease,
    };
    let data = index.execute(serde_json::json!({"protocol":1,"operation":"init"}), None)?;
    let count = data["count"]
        .as_u64()
        .ok_or_else(|| ApiError::Message("Invalid search count.".into()))?;
    let reader = IndexReader {
        index: index.clone(),
        count,
    };
    Ok((index, reader, SearchIndexFields))
}
pub(super) fn add_doc(
    writer: &IndexWriter,
    _fields: &SearchIndexFields,
    doc: &SearchDoc,
) -> ApiResult<()> {
    writer.append(serde_json::json!({"add":doc}))
}
pub(super) fn delete_doc(
    writer: &IndexWriter,
    _fields: &SearchIndexFields,
    path: &str,
) -> ApiResult<()> {
    writer.append(serde_json::json!({"delete":path}))
}
pub(super) fn query_documents(
    reader: &IndexReader,
    _fields: SearchIndexFields,
    text: &str,
) -> ApiResult<Vec<SearchDoc>> {
    let value = reader.index.execute(
        serde_json::json!({"protocol":1,"operation":"query","query":text}),
        None,
    )?;
    Ok(serde_json::from_value(value["docs"].clone())?)
}
pub(super) fn seed_search_manifest(
    manifest: &Mutex<Connection>,
    reader: &IndexReader,
    _fields: SearchIndexFields,
) -> ApiResult<()> {
    let manifest = manifest
        .lock()
        .map_err(|e| ApiError::Message(e.to_string()))?;
    let mut offset = 0;
    loop {
        let value = reader.index.execute(
            serde_json::json!({"protocol":1,"operation":"dump","offset":offset}),
            None,
        )?;
        let docs: Vec<SearchDoc> = serde_json::from_value(value["docs"].clone())?;
        for doc in docs {
            persist_manifest_doc(&manifest, &doc, 0)?;
        }
        if value["done"].as_bool() == Some(true) {
            break;
        }
        let next = value["next"]
            .as_u64()
            .filter(|next| *next > offset)
            .ok_or_else(|| ApiError::Message("Search catalog made no progress.".into()))?;
        offset = next;
    }
    Ok(())
}
