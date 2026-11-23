// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! The index's two halves, both in `files-index/` in this build's Misty data folder: the tantivy
//! index of names (`index/`), which answers searches, and the scan manifest
//! (`manifest.sqlite3`), one row per indexed item with what a scan compares (kind, size, modified
//! time), so an unchanged tree is checked by reads alone. Only the local disk is indexed.
//!
//! Every change goes to both, and the tantivy side commits first: an interrupted update leaves the
//! manifest behind the index, never ahead, and since every add deletes the path's old document
//! first, catching up never doubles an entry.
use std::path::{Path, PathBuf};

use file_access::{fs, Access};
use rusqlite::{params, Connection, OptionalExtension};
use tantivy::{
    doc,
    schema::{
        Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, STORED,
        STRING,
    },
    Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term,
};

const SCHEMA_VERSION: i64 = 1;
const WRITER_BUDGET: usize = 32 * 1024 * 1024;
const MANIFEST_FILE: &str = "manifest.sqlite3";

#[derive(Clone, Copy, Debug)]
pub(super) struct Fields {
    pub path: Field,
    pub name: Field,
    pub extension: Field,
    pub is_file: Field,
    pub is_dir: Field,
    pub size: Field,
    pub modified_ms: Field,
    pub hidden: Field,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Doc {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub is_file: bool,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub hidden: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Signature {
    is_file: bool,
    is_dir: bool,
    size: u64,
    modified_ms: u64,
    hidden: bool,
}

impl From<&Doc> for Signature {
    fn from(doc: &Doc) -> Self {
        Self {
            is_file: doc.is_file,
            is_dir: doc.is_dir,
            size: doc.size,
            modified_ms: doc.modified_ms,
            hidden: doc.hidden,
        }
    }
}

pub(super) struct Catalog {
    pub index: Index,
    pub fields: Fields,
    pub reader: IndexReader,
    pub manifest: Connection,
}

fn build_schema() -> (Schema, Fields) {
    let mut builder = Schema::builder();
    let name_indexing = TextFieldIndexing::default()
        .set_tokenizer("default")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let name_options = TextOptions::default()
        .set_indexing_options(name_indexing)
        .set_stored();
    let fields = Fields {
        path: builder.add_text_field("path", STRING | STORED),
        name: builder.add_text_field("name", name_options),
        extension: builder.add_text_field("extension", STRING | STORED),
        is_file: builder.add_u64_field("is_file", FAST | STORED),
        is_dir: builder.add_u64_field("is_dir", FAST | STORED),
        size: builder.add_u64_field("size", FAST | STORED),
        modified_ms: builder.add_u64_field("modified_ms", FAST | STORED),
        hidden: builder.add_u64_field("hidden", FAST | STORED),
    };
    (builder.build(), fields)
}

fn index_error(error: impl std::fmt::Display) -> String {
    format!("The search index couldn't be opened: {error}")
}

fn manifest_error(error: rusqlite::Error) -> String {
    format!("The search index's list couldn't be read: {error}")
}

fn open_index(dir: &Path, schema: Schema, fresh: bool) -> Result<(Index, bool), String> {
    fs::create_dir_all(dir).map_err(index_error)?;
    file_access::check(dir, Access::Write).map_err(index_error)?;
    if !fresh {
        if let Ok(index) = Index::open_in_dir(dir) {
            if index.schema() == schema {
                return Ok((index, false));
            }
        }
    }
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir).map_err(index_error)?;
    Index::create_in_dir(dir, schema)
        .map(|index| (index, true))
        .map_err(index_error)
}

pub(super) fn open(root: &Path) -> Result<Catalog, String> {
    fs::create_dir_all(root).map_err(index_error)?;
    let manifest = fs::open_sqlite(root.join(MANIFEST_FILE)).map_err(manifest_error)?;
    manifest
        .execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -32768;",
        )
        .map_err(manifest_error)?;
    let version: i64 = manifest
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(manifest_error)?;
    let (schema, fields) = build_schema();
    let (index, fresh) = open_index(&root.join("index"), schema, version != SCHEMA_VERSION)?;
    if fresh || version != SCHEMA_VERSION {
        manifest
            .execute_batch(&format!(
                "DROP TABLE IF EXISTS search_docs;
                 CREATE TABLE search_docs (
                   path TEXT PRIMARY KEY,
                   is_file INTEGER NOT NULL,
                   is_dir INTEGER NOT NULL,
                   size INTEGER NOT NULL,
                   modified_ms INTEGER NOT NULL,
                   hidden INTEGER NOT NULL
                 ) WITHOUT ROWID;
                 PRAGMA user_version = {SCHEMA_VERSION};"
            ))
            .map_err(manifest_error)?;
    }
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()
        .map_err(index_error)?;
    Ok(Catalog {
        index,
        fields,
        reader,
        manifest,
    })
}

pub(super) fn writer(index: &Index) -> Result<IndexWriter, String> {
    index
        .writer_with_num_threads(1, WRITER_BUDGET)
        .map_err(index_error)
}

pub(super) fn put_doc(writer: &IndexWriter, fields: &Fields, doc: &Doc) -> Result<(), String> {
    delete_doc(writer, fields, &doc.path);
    writer
        .add_document(doc!(
            fields.path => doc.path.clone(),
            fields.name => doc.name.clone(),
            fields.extension => doc.extension.clone(),
            fields.is_file => u64::from(doc.is_file),
            fields.is_dir => u64::from(doc.is_dir),
            fields.size => doc.size,
            fields.modified_ms => doc.modified_ms,
            fields.hidden => u64::from(doc.hidden),
        ))
        .map(|_| ())
        .map_err(index_error)
}

pub(super) fn delete_doc(writer: &IndexWriter, fields: &Fields, path: &str) {
    writer.delete_term(Term::from_field_text(fields.path, path));
}

pub(super) fn doc_from(fields: &Fields, doc: &TantivyDocument) -> Option<Doc> {
    let text = |field: Field| {
        doc.get_first(field)
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned)
    };
    let number = |field: Field| {
        doc.get_first(field)
            .and_then(|value| value.as_u64())
            .unwrap_or(0)
    };
    Some(Doc {
        path: text(fields.path)?,
        name: text(fields.name)?,
        extension: text(fields.extension).unwrap_or_default(),
        is_file: number(fields.is_file) == 1,
        is_dir: number(fields.is_dir) == 1,
        size: number(fields.size),
        modified_ms: number(fields.modified_ms),
        hidden: number(fields.hidden) == 1,
    })
}

pub(super) fn local_doc(path: &Path, meta: &file_access::disk::fs_disk::Metadata) -> Option<Doc> {
    let name = path.file_name().and_then(|name| name.to_str())?;
    Some(Doc {
        path: path.to_string_lossy().into_owned(),
        name: name.to_owned(),
        extension: path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase(),
        is_file: meta.is_file(),
        is_dir: meta.is_dir(),
        size: if meta.is_file() { meta.len() } else { 0 },
        modified_ms: meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_millis() as u64)
            .unwrap_or(0),
        hidden: name.starts_with('.'),
    })
}

pub(super) fn lookup(manifest: &Connection, path: &str) -> Result<Option<Signature>, String> {
    manifest
        .prepare_cached(
            "SELECT is_file, is_dir, size, modified_ms, hidden FROM search_docs WHERE path = ?1",
        )
        .map_err(manifest_error)?
        .query_row(params![path], |row| {
            Ok(Signature {
                is_file: row.get::<_, i64>(0)? != 0,
                is_dir: row.get::<_, i64>(1)? != 0,
                size: row.get(2)?,
                modified_ms: row.get(3)?,
                hidden: row.get::<_, i64>(4)? != 0,
            })
        })
        .optional()
        .map_err(manifest_error)
}

pub(super) fn persist(manifest: &Connection, doc: &Doc) -> Result<(), String> {
    manifest
        .prepare_cached(
            "INSERT INTO search_docs (path, is_file, is_dir, size, modified_ms, hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path) DO UPDATE SET is_file = excluded.is_file, is_dir = excluded.is_dir,
               size = excluded.size, modified_ms = excluded.modified_ms, hidden = excluded.hidden",
        )
        .map_err(manifest_error)?
        .execute(params![
            doc.path,
            i64::from(doc.is_file),
            i64::from(doc.is_dir),
            doc.size,
            doc.modified_ms,
            i64::from(doc.hidden)
        ])
        .map(|_| ())
        .map_err(manifest_error)
}

pub(super) fn forget(manifest: &Connection, path: &str) -> Result<(), String> {
    manifest
        .prepare_cached("DELETE FROM search_docs WHERE path = ?1")
        .map_err(manifest_error)?
        .execute(params![path])
        .map(|_| ())
        .map_err(manifest_error)
}

fn range_below(root: &str) -> (String, String) {
    let separator = if cfg!(windows) { '\\' } else { '/' };
    let lower = if root.ends_with(['/', '\\']) {
        root.to_owned()
    } else {
        format!("{root}{separator}")
    };
    let mut upper = lower.clone();
    let last = upper.pop().unwrap_or(separator);
    upper.push(char::from_u32(last as u32 + 1).unwrap_or(char::MAX));
    (lower, upper)
}

pub(super) fn count_below(manifest: &Connection, root: &str) -> Result<u64, String> {
    let (lower, upper) = range_below(root);
    manifest
        .query_row(
            "SELECT COUNT(*) FROM search_docs WHERE path > ?1 AND path < ?2",
            params![lower, upper],
            |row| row.get(0),
        )
        .map_err(manifest_error)
}

pub(super) fn paths_below(manifest: &Connection, root: &str) -> Result<Vec<String>, String> {
    let (lower, upper) = range_below(root);
    let mut statement = manifest
        .prepare_cached("SELECT path FROM search_docs WHERE path > ?1 AND path < ?2")
        .map_err(manifest_error)?;
    let rows = statement
        .query_map(params![lower, upper], |row| row.get::<_, String>(0))
        .map_err(manifest_error)?;
    rows.collect::<Result<_, _>>().map_err(manifest_error)
}

pub(super) fn root() -> Option<PathBuf> {
    file_access::paths::misty_home_dir().map(|home| home.join("files-index"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn the_range_below_a_folder_holds_exactly_what_is_inside_it() {
        let (lower, upper) = range_below("/Users/a/Documents");
        let inside = |path: &str| path > lower.as_str() && path < upper.as_str();
        assert!(inside("/Users/a/Documents/x.txt"));
        assert!(inside("/Users/a/Documents/deep/y.txt"));
        assert!(!inside("/Users/a/Documents"));
        assert!(!inside("/Users/a/Documents 2/z.txt"));
        assert!(!inside("/Users/a/Documents-old"));
    }
}
