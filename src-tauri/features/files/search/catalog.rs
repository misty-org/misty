// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! The index's two halves, both in `files-index/` in this build's Misty data folder: the tantivy
//! index of names (`index/`), which answers searches, and the scan manifest
//! (`manifest.sqlite3`), one row per indexed item with what a scan compares (kind, size, modified
//! time), so an unchanged tree is checked by reads alone, and the last file event the index took,
//! so a later start picks up where it left off. Only the local disk is indexed.
//!
//! Every change goes to both, and the tantivy side commits first: an interrupted update leaves the
//! manifest behind the index, never ahead, and since every add deletes the path's old document
//! first, catching up never doubles an entry. A result is read from fast fields alone.
use std::path::{Path, PathBuf};

use file_access::{fs, Access};
use rusqlite::{params, Connection, OptionalExtension};
use tantivy::{
    doc,
    schema::{Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, FAST, STRING},
    Index, IndexReader, IndexWriter, ReloadPolicy, Term,
};

pub(super) const SCHEMA_VERSION: i64 = 2;
const WRITER_BUDGET: usize = 32 * 1024 * 1024;
const MANIFEST_FILE: &str = "manifest.sqlite3";
const LAST_EVENT: &str = "last_event_id";

pub(super) const PATH: &str = "path";
pub(super) const IS_DIR: &str = "is_dir";
pub(super) const HIDDEN: &str = "hidden";

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
    pub writer: IndexWriter,
}

pub(super) fn build_schema() -> (Schema, Fields) {
    let mut builder = Schema::builder();
    let name_indexing = TextFieldIndexing::default()
        .set_tokenizer("default")
        .set_index_option(IndexRecordOption::WithFreqs);
    let name_options = TextOptions::default().set_indexing_options(name_indexing);
    let fields = Fields {
        path: builder.add_text_field(PATH, STRING | FAST),
        name: builder.add_text_field("name", name_options),
        extension: builder.add_text_field("extension", STRING),
        is_file: builder.add_u64_field("is_file", FAST),
        is_dir: builder.add_u64_field(IS_DIR, FAST),
        size: builder.add_u64_field("size", FAST),
        modified_ms: builder.add_u64_field("modified_ms", FAST),
        hidden: builder.add_u64_field(HIDDEN, FAST),
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

fn reset_manifest(manifest: &Connection) -> Result<(), String> {
    manifest
        .execute_batch(&format!(
            "DROP TABLE IF EXISTS search_docs;
             DROP TABLE IF EXISTS search_meta;
             CREATE TABLE search_docs (
               path TEXT PRIMARY KEY,
               is_file INTEGER NOT NULL,
               is_dir INTEGER NOT NULL,
               size INTEGER NOT NULL,
               modified_ms INTEGER NOT NULL,
               hidden INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE TABLE search_meta (
               key TEXT PRIMARY KEY,
               value INTEGER NOT NULL
             ) WITHOUT ROWID;
             PRAGMA user_version = {SCHEMA_VERSION};"
        ))
        .map_err(manifest_error)
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
        reset_manifest(&manifest)?;
    }
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()
        .map_err(index_error)?;
    let writer = index
        .writer_with_num_threads(1, WRITER_BUDGET)
        .map_err(index_error)?;
    Ok(Catalog {
        index,
        fields,
        reader,
        manifest,
        writer,
    })
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

fn time_ms(time: Option<std::time::SystemTime>) -> u64 {
    time.and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

pub(super) fn doc_at(
    path: &Path,
    is_file: bool,
    is_dir: bool,
    size: u64,
    modified: Option<std::time::SystemTime>,
) -> Option<Doc> {
    let name = path.file_name().and_then(|name| name.to_str())?;
    Some(Doc {
        path: path.to_string_lossy().into_owned(),
        name: name.to_owned(),
        extension: path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase(),
        is_file,
        is_dir,
        size: if is_file { size } else { 0 },
        modified_ms: time_ms(modified),
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

pub(super) fn stored_event(manifest: &Connection) -> Result<Option<u64>, String> {
    manifest
        .prepare_cached("SELECT value FROM search_meta WHERE key = ?1")
        .map_err(manifest_error)?
        .query_row(params![LAST_EVENT], |row| row.get::<_, i64>(0))
        .optional()
        .map(|value| value.map(|value| value as u64))
        .map_err(manifest_error)
}

pub(super) fn store_event(manifest: &Connection, id: u64) -> Result<(), String> {
    manifest
        .prepare_cached(
            "INSERT INTO search_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .map_err(manifest_error)?
        .execute(params![LAST_EVENT, id as i64])
        .map(|_| ())
        .map_err(manifest_error)
}

pub(super) fn forget_event(manifest: &Connection) -> Result<(), String> {
    manifest
        .prepare_cached("DELETE FROM search_meta WHERE key = ?1")
        .map_err(manifest_error)?
        .execute(params![LAST_EVENT])
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

    #[test]
    fn an_index_from_an_older_schema_is_built_again_once() {
        let directory = tempfile::Builder::new()
            .prefix("misty-index-")
            .tempdir()
            .unwrap();
        let root = directory.path().join("files-index");
        {
            let mut catalog = open(&root).unwrap();
            let doc = doc_at(Path::new("/home/me/notes.txt"), true, false, 3, None).unwrap();
            put_doc(&catalog.writer, &catalog.fields, &doc).unwrap();
            catalog.writer.commit().unwrap();
            persist(&catalog.manifest, &doc).unwrap();
            store_event(&catalog.manifest, 42).unwrap();
        }
        {
            let catalog = open(&root).unwrap();
            catalog.reader.reload().unwrap();
            assert_eq!(catalog.reader.searcher().num_docs(), 1);
            assert_eq!(stored_event(&catalog.manifest).unwrap(), Some(42));
            catalog
                .manifest
                .execute_batch("PRAGMA user_version = 1;")
                .unwrap();
        }
        let catalog = open(&root).unwrap();
        catalog.reader.reload().unwrap();
        assert_eq!(catalog.reader.searcher().num_docs(), 0);
        assert_eq!(stored_event(&catalog.manifest).unwrap(), None);
        assert_eq!(
            lookup(&catalog.manifest, "/home/me/notes.txt").unwrap(),
            None
        );
        let version: i64 = catalog
            .manifest
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }
}
