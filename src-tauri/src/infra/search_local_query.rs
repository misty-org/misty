use tantivy::{collector::TopDocs, IndexReader, TantivyDocument};

use super::{build_query, doc_from_tantivy, SearchDoc, SearchIndexFields};
use crate::error::{ApiError, ApiResult};

pub(super) fn query_documents(
    reader: &IndexReader,
    fields: SearchIndexFields,
    text: &str,
) -> ApiResult<Vec<SearchDoc>> {
    let searcher = reader.searcher();
    let hits = searcher
        .search(
            &build_query(fields, text),
            &TopDocs::with_limit(10_000).order_by_score(),
        )
        .map_err(|e| ApiError::Message(e.to_string()))?;
    hits.into_iter()
        .filter_map(
            |(_, address)| match searcher.doc::<TantivyDocument>(address) {
                Ok(doc) => doc_from_tantivy(fields, &doc).map(Ok),
                Err(e) => Some(Err(ApiError::Message(e.to_string()))),
            },
        )
        .collect()
}
