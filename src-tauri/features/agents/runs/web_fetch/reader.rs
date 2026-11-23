use futures_util::future::BoxFuture;
use page_text::readable::{readable_page, ReadableError, ReadablePage};
use thiserror::Error;

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum PageReadError {
    #[error("the page has no document element")]
    NoDocumentElement,
    #[error("{0}")]
    Reader(String),
}

pub trait PageReader: Send + Sync {
    fn read<'a>(
        &'a self,
        html: &'a str,
        content_type: &'a str,
        question: &'a str,
        limit: usize,
    ) -> BoxFuture<'a, Result<ReadablePage, PageReadError>>;
}

pub struct InProcessPageReader;

impl PageReader for InProcessPageReader {
    fn read<'a>(
        &'a self,
        html: &'a str,
        content_type: &'a str,
        question: &'a str,
        limit: usize,
    ) -> BoxFuture<'a, Result<ReadablePage, PageReadError>> {
        Box::pin(async move {
            readable_page(html, content_type, question, limit).map_err(|error| match error {
                ReadableError::NoDocumentElement => PageReadError::NoDocumentElement,
            })
        })
    }
}
