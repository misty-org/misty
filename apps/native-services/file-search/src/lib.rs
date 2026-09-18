use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tantivy::{
    collector::TopDocs,
    doc,
    query::{AllQuery, BooleanQuery, FuzzyTermQuery, Occur, Query, TermQuery},
    schema::{
        Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, STORED,
        STRING,
    },
    Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term,
};
#[derive(Debug, thiserror::Error)]
enum ApiError {
    #[error("{0}")]
    Message(String),
}
type ApiResult<T> = Result<T, ApiError>;
#[derive(Debug, Clone, Copy)]
struct SearchIndexFields {
    path: Field,
    name: Field,
    name_lower: Field,
    extension: Field,
    source_kind: Field,
    provider_type: Field,
    remote_name: Field,
    remote_path: Field,
    mime_type: Field,
    is_file: Field,
    is_dir: Field,
    size: Field,
    modified_ms: Field,
    hidden: Field,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchSourceKind {
    Local,
    Remote,
}

impl SearchSourceKind {
    fn as_str(self) -> &'static str {
        match self {
            SearchSourceKind::Local => "local",
            SearchSourceKind::Remote => "remote",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SearchDoc {
    path: String,
    name: String,
    extension: String,
    source_kind: SearchSourceKind,
    provider_type: String,
    remote_name: String,
    remote_path: String,
    mime_type: String,
    is_file: bool,
    is_dir: bool,
    size: u64,
    modified_ms: u64,
    hidden: bool,
}

fn build_schema() -> (Schema, SearchIndexFields) {
    let mut builder = Schema::builder();
    let name_indexing = TextFieldIndexing::default()
        .set_tokenizer("default")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let name_options = TextOptions::default()
        .set_indexing_options(name_indexing)
        .set_stored();
    let path = builder.add_text_field("path", STRING | STORED);
    let name = builder.add_text_field("name", name_options);
    let name_lower = builder.add_text_field("name_lower", STRING | STORED);
    let extension = builder.add_text_field("extension", STRING | STORED);
    let source_kind = builder.add_text_field("source_kind", STRING | STORED);
    let provider_type = builder.add_text_field("provider_type", STRING | STORED);
    let remote_name = builder.add_text_field("remote_name", STRING | STORED);
    let remote_path = builder.add_text_field("remote_path", STRING | STORED);
    let mime_type = builder.add_text_field("mime_type", STRING | STORED);
    let is_file = builder.add_u64_field("is_file", FAST | STORED);
    let is_dir = builder.add_u64_field("is_dir", FAST | STORED);
    let size = builder.add_u64_field("size", FAST | STORED);
    let modified_ms = builder.add_u64_field("modified_ms", FAST | STORED);
    let hidden = builder.add_u64_field("hidden", FAST | STORED);
    let schema = builder.build();
    (
        schema,
        SearchIndexFields {
            path,
            name,
            name_lower,
            extension,
            source_kind,
            provider_type,
            remote_name,
            remote_path,
            mime_type,
            is_file,
            is_dir,
            size,
            modified_ms,
            hidden,
        },
    )
}

fn open_or_create_index(path: &Path) -> ApiResult<(Index, IndexReader, SearchIndexFields)> {
    fs::create_dir_all(path).map_err(|error| {
        ApiError::Message(format!(
            "Failed to create search index {}: {error}",
            path.display()
        ))
    })?;
    let (schema, fields) = build_schema();
    let index = match Index::open_in_dir(path) {
        Ok(index) if index.schema() == schema => index,
        _ => {
            let _ = fs::remove_dir_all(path);
            fs::create_dir_all(path).map_err(|error| {
                ApiError::Message(format!(
                    "Failed to reset search index {}: {error}",
                    path.display()
                ))
            })?;
            Index::create_in_dir(path, schema)
                .map_err(|error| ApiError::Message(error.to_string()))?
        }
    };
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()
        .map_err(|error| ApiError::Message(error.to_string()))?;
    Ok((index, reader, fields))
}

fn add_doc(
    writer: &IndexWriter,
    fields: &SearchIndexFields,
    search_doc: &SearchDoc,
) -> ApiResult<()> {
    writer
        .add_document(doc!(
            fields.path => search_doc.path.clone(),
            fields.name => search_doc.name.clone(),
            fields.name_lower => normalize_case(&search_doc.name),
            fields.extension => search_doc.extension.clone(),
            fields.source_kind => search_doc.source_kind.as_str(),
            fields.provider_type => search_doc.provider_type.clone(),
            fields.remote_name => search_doc.remote_name.clone(),
            fields.remote_path => search_doc.remote_path.clone(),
            fields.mime_type => search_doc.mime_type.clone(),
            fields.is_file => if search_doc.is_file { 1u64 } else { 0u64 },
            fields.is_dir => if search_doc.is_dir { 1u64 } else { 0u64 },
            fields.size => search_doc.size,
            fields.modified_ms => search_doc.modified_ms,
            fields.hidden => if search_doc.hidden { 1u64 } else { 0u64 },
        ))
        .map_err(|error| ApiError::Message(error.to_string()))?;
    Ok(())
}

fn build_query(fields: SearchIndexFields, query: &str) -> Box<dyn Query> {
    let tokens = split_tokens(query);
    if tokens.is_empty() {
        return Box::new(AllQuery);
    }
    let mut queries: Vec<(Occur, Box<dyn Query>)> = Vec::new();
    for token in tokens {
        let term = Term::from_field_text(fields.name, &token);
        queries.push((Occur::Should, Box::new(FuzzyTermQuery::new(term, 2, true))));
        let exact = Term::from_field_text(fields.name, &token);
        queries.push((
            Occur::Should,
            Box::new(TermQuery::new(exact, IndexRecordOption::Basic)),
        ));
    }
    Box::new(BooleanQuery::from(queries))
}

fn doc_from_tantivy(fields: SearchIndexFields, doc: &TantivyDocument) -> Option<SearchDoc> {
    let path = text_field(doc, fields.path)?;
    let name = text_field(doc, fields.name)?;
    let source_kind = match text_field(doc, fields.source_kind)?.as_str() {
        "remote" => SearchSourceKind::Remote,
        _ => SearchSourceKind::Local,
    };
    Some(SearchDoc {
        path,
        name,
        extension: text_field(doc, fields.extension).unwrap_or_default(),
        source_kind,
        provider_type: text_field(doc, fields.provider_type).unwrap_or_default(),
        remote_name: text_field(doc, fields.remote_name).unwrap_or_default(),
        remote_path: text_field(doc, fields.remote_path).unwrap_or_default(),
        mime_type: text_field(doc, fields.mime_type).unwrap_or_default(),
        is_file: u64_field(doc, fields.is_file) == 1,
        is_dir: u64_field(doc, fields.is_dir) == 1,
        size: u64_field(doc, fields.size),
        modified_ms: u64_field(doc, fields.modified_ms),
        hidden: u64_field(doc, fields.hidden) == 1,
    })
}

fn text_field(doc: &TantivyDocument, field: Field) -> Option<String> {
    doc.get_first(field)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn u64_field(doc: &TantivyDocument, field: Field) -> u64 {
    doc.get_first(field)
        .and_then(|value| value.as_u64())
        .unwrap_or(0)
}

fn split_tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| {
            character.is_whitespace() || matches!(character, '.' | '_' | '-' | '/')
        })
        .filter(|segment| !segment.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn normalize_case(value: &str) -> String {
    value.trim().to_lowercase()
}

/// The host supplies a private index directory and a fixed staged mutation file.
/// No request can choose a filesystem path or request a shell command.
pub fn execute(
    index_path: &Path,
    work: &Path,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use std::io::{BufRead, BufReader, Read};
    if request["protocol"].as_u64() != Some(1) {
        return Err("Incompatible search protocol.".into());
    }
    let (index, reader, fields) = open_or_create_index(index_path).map_err(|e| e.to_string())?;
    let result: ApiResult<serde_json::Value> = (|| match request["operation"].as_str() {
        Some("init") => Ok(serde_json::json!({"count":reader.searcher().num_docs()})),
        Some("query") => {
            let text = request["query"]
                .as_str()
                .ok_or_else(|| ApiError::Message("Missing query".into()))?;
            if text.len() > 16384 {
                return Err(ApiError::Message("Query is too long".into()));
            }
            let searcher = reader.searcher();
            let hits = searcher
                .search(&build_query(fields, text), &TopDocs::with_limit(10_000))
                .map_err(|e| ApiError::Message(e.to_string()))?;
            let mut docs = Vec::new();
            for (_, address) in hits {
                let doc = searcher
                    .doc::<TantivyDocument>(address)
                    .map_err(|e| ApiError::Message(e.to_string()))?;
                if let Some(doc) = doc_from_tantivy(fields, &doc) {
                    docs.push(doc);
                }
            }
            Ok(serde_json::json!({"docs":docs}))
        }
        Some("dump") => {
            let offset = request["offset"].as_u64().unwrap_or(0);
            let searcher = reader.searcher();
            let mut docs = Vec::new();
            let mut seen = 0u64;
            'segments: for (ordinal, segment) in searcher.segment_readers().iter().enumerate() {
                for id in 0..segment.max_doc() {
                    if segment.is_deleted(id) {
                        continue;
                    }
                    seen += 1;
                    if seen <= offset {
                        continue;
                    }
                    let doc = searcher
                        .doc::<TantivyDocument>(tantivy::DocAddress::new(ordinal as u32, id))
                        .map_err(|e| ApiError::Message(e.to_string()))?;
                    if let Some(doc) = doc_from_tantivy(fields, &doc) {
                        docs.push(doc);
                    }
                    if seen - offset >= 1000 {
                        break 'segments;
                    }
                }
            }
            Ok(serde_json::json!({"docs":docs,"next":seen,"done":seen>=searcher.num_docs()}))
        }
        Some("apply") => {
            let file = fs::File::open(work.join("mutations.jsonl"))
                .map_err(|e| ApiError::Message(e.to_string()))?;
            let mut input = BufReader::new(file);
            let mut writer = index
                .writer_with_num_threads(1, 96 * 1024 * 1024)
                .map_err(|e| ApiError::Message(e.to_string()))?;
            loop {
                let mut line = String::new();
                let size = input
                    .by_ref()
                    .take(1024 * 1024 + 1)
                    .read_line(&mut line)
                    .map_err(|e| ApiError::Message(e.to_string()))?;
                if size == 0 {
                    break;
                }
                if size > 1024 * 1024 {
                    return Err(ApiError::Message("Search record exceeds its limit.".into()));
                }
                let value: serde_json::Value =
                    serde_json::from_str(&line).map_err(|e| ApiError::Message(e.to_string()))?;
                if let Some(path) = value["delete"].as_str() {
                    writer.delete_term(Term::from_field_text(fields.path, path));
                } else if let Some(value) = value.get("add") {
                    let doc: SearchDoc = serde_json::from_value(value.clone())
                        .map_err(|e| ApiError::Message(e.to_string()))?;
                    add_doc(&writer, &fields, &doc)?;
                } else {
                    return Err(ApiError::Message("Invalid index mutation.".into()));
                }
            }
            writer
                .commit()
                .map_err(|e| ApiError::Message(e.to_string()))?;
            Ok(serde_json::json!({}))
        }
        _ => Err(ApiError::Message("Unknown search operation.".into())),
    })();
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn document(path: &str, name: &str) -> serde_json::Value {
        serde_json::json!({"path":path,"name":name,"extension":"txt","source_kind":"local","provider_type":"","remote_name":"","remote_path":"","mime_type":"text/plain","is_file":true,"is_dir":false,"size":42,"modified_ms":100,"hidden":false})
    }
    fn call(
        root: &Path,
        work: &Path,
        operation: &str,
        extra: serde_json::Value,
    ) -> serde_json::Value {
        let mut request = extra;
        request["protocol"] = 1.into();
        request["operation"] = operation.into();
        execute(root, work, request).unwrap()
    }
    #[test]
    fn persists_fuzzy_search_updates_deletions_and_separate_indexes() {
        let root = tempfile::tempdir().unwrap();
        let work = tempfile::tempdir().unwrap();
        let a = root.path().join("family");
        let b = root.path().join("work");
        assert_eq!(
            call(&a, work.path(), "init", serde_json::json!({}))["count"],
            0
        );
        let doc = document("/approved/Pikachu.txt", "Pikachu.txt");
        fs::write(
            work.path().join("mutations.jsonl"),
            format!("{}\n", serde_json::json!({"add":doc})),
        )
        .unwrap();
        call(&a, work.path(), "apply", serde_json::json!({}));
        assert_eq!(
            call(
                &a,
                work.path(),
                "query",
                serde_json::json!({"query":"pikchu"})
            )["docs"][0],
            doc
        );
        assert_eq!(
            call(
                &b,
                work.path(),
                "query",
                serde_json::json!({"query":"pikachu"})
            )["docs"],
            serde_json::json!([])
        );
        let updated = document("/approved/Pikachu.txt", "Pikachu updated.txt");
        fs::write(
            work.path().join("mutations.jsonl"),
            format!(
                "{}\n{}\n",
                serde_json::json!({"delete":"/approved/Pikachu.txt"}),
                serde_json::json!({"add":updated})
            ),
        )
        .unwrap();
        call(&a, work.path(), "apply", serde_json::json!({}));
        assert_eq!(
            call(&a, work.path(), "init", serde_json::json!({}))["count"],
            1
        );
        assert_eq!(
            call(&a, work.path(), "dump", serde_json::json!({}))["docs"][0],
            updated
        );
        fs::write(
            work.path().join("mutations.jsonl"),
            "{\"delete\":\"/approved/Pikachu.txt\"}\n",
        )
        .unwrap();
        call(&a, work.path(), "apply", serde_json::json!({}));
        assert_eq!(
            call(&a, work.path(), "init", serde_json::json!({}))["count"],
            0
        );
    }
    #[test]
    fn rejects_wrong_protocol_unknown_operations_and_partial_mutations() {
        let root = tempfile::tempdir().unwrap();
        let work = tempfile::tempdir().unwrap();
        assert!(execute(
            root.path(),
            work.path(),
            serde_json::json!({"protocol":2,"operation":"init"})
        )
        .is_err());
        assert!(execute(
            root.path(),
            work.path(),
            serde_json::json!({"protocol":1,"operation":"shell"})
        )
        .is_err());
        fs::write(
            work.path().join("mutations.jsonl"),
            format!(
                "{}\ninvalid\n",
                serde_json::json!({"add":document("/a","alpha.txt")})
            ),
        )
        .unwrap();
        assert!(execute(
            root.path(),
            work.path(),
            serde_json::json!({"protocol":1,"operation":"apply"})
        )
        .is_err());
        assert_eq!(
            call(root.path(), work.path(), "init", serde_json::json!({}))["count"],
            0
        );
    }
}
