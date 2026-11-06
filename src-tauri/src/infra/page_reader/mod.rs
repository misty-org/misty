//! Reads the pages `web.fetch` gets in a worker the OS confines (`permission-page-reader`), so Misty's
//! own process never parses them: `sandbox-exec` on macOS and an AppContainer on Windows. The worker
//! runs the same code as `readable_page` (`src-tauri/crates/page-reader`). If it fails, that fetch
//! fails. There is no way back to reading in this process.
use futures_util::future::BoxFuture;
use misty_agent::runtime::{PageReadError, PageReader, ReadablePage};
use misty_page_reader::{
    protocol::{decode_answer, encode_request, ProtocolError},
    readable::ReadableError,
};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as worker;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as worker;

/// Longer than any honest page takes, and the same as a fetch's own limit.
const TIME_LIMIT_SECONDS: u64 = 20;

#[cfg(not(any(target_os = "macos", windows)))]
mod worker {
    pub(super) async fn run(_input: Vec<u8>) -> Result<Vec<u8>, String> {
        Err("The page reader isn't built for this system.".to_owned())
    }
    pub(super) fn clean_up() {}
}

pub(crate) struct ConfinedPageReader;

async fn read(
    html: &str,
    content_type: &str,
    question: &str,
    limit: usize,
) -> Result<ReadablePage, PageReadError> {
    let refused = |what: &str| PageReadError::Reader(what.to_owned());
    let input = encode_request(html, content_type, question, limit)
        .map_err(|_| refused("the page is over the reader's limit"))?;
    let output = worker::run(input).await.map_err(PageReadError::Reader)?;
    match decode_answer(&output) {
        Ok(Ok(page)) => Ok(page),
        Ok(Err(ReadableError::NoDocumentElement)) => Err(PageReadError::NoDocumentElement),
        Err(ProtocolError::TooLarge) => Err(refused("the reader's answer is over its limit")),
        Err(ProtocolError::Refused) => Err(refused("the reader refused its input")),
        Err(ProtocolError::Unreadable) => Err(refused("the reader's answer didn't read")),
    }
}

impl PageReader for ConfinedPageReader {
    fn read<'a>(
        &'a self,
        html: &'a str,
        content_type: &'a str,
        question: &'a str,
        limit: usize,
    ) -> BoxFuture<'a, Result<ReadablePage, PageReadError>> {
        Box::pin(read(html, content_type, question, limit))
    }
}

/// Removes what the reader left on disk, as Misty exits.
pub(crate) fn clean_up() {
    worker::clean_up();
}
