//! Who reads a fetched page. The page is untrusted, so the app reads it in a worker the OS confines
//! (`permission-page-reader`). Reading it right here is for tests and small programs only: the app's
//! reader never falls back to it.
use futures_util::future::BoxFuture;
use page_text::readable::{readable_page, ReadableError, ReadablePage};
use thiserror::Error;

/// Why a page wasn't read.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum PageReadError {
    /// The page has nothing to read, which the reader got to say.
    #[error("the page has no document element")]
    NoDocumentElement,
    /// The reader itself failed: it didn't start, ran out of time or gave no usable answer. The words
    /// go to the log and never mention the page's contents.
    #[error("{0}")]
    Reader(String),
}

/// [`readable_page`], wherever it runs. Whoever implements this answers exactly as it does.
pub trait PageReader: Send + Sync {
    fn read<'a>(&'a self, html: &'a str, content_type: &'a str, question: &'a str, limit: usize) -> BoxFuture<'a, Result<ReadablePage, PageReadError>>;
}

/// Reads the page in this process. The default for tests.
pub struct InProcessPageReader;

impl PageReader for InProcessPageReader {
    fn read<'a>(&'a self, html: &'a str, content_type: &'a str, question: &'a str, limit: usize) -> BoxFuture<'a, Result<ReadablePage, PageReadError>> {
        Box::pin(async move {
            readable_page(html, content_type, question, limit).map_err(|error| match error {
                ReadableError::NoDocumentElement => PageReadError::NoDocumentElement,
            })
        })
    }
}
