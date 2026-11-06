//! The page reader on Windows: the same worker in an AppContainer with no network, as documents are
//! (`worker_windows.rs`). The helper is written out for each read, because `Workspace` owns that; how
//! long that takes hasn't been measured on Windows.
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use misty_page_reader::protocol::{MAX_ANSWER_BYTES, MAX_INPUT_BYTES, PROTOCOL};

use crate::platform::shared_windows::sandbox::{Limits, Workspace};

const CONTAINER: &str = "Misty.PageReader";

struct CancelOnDrop(Arc<AtomicBool>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

/// The worker's whole output for this input. There's no permissive fallback: any failure is the error.
pub(super) async fn run(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let _cancel = CancelOnDrop(stop.clone());
    tokio::task::spawn_blocking(move || {
        let worker = crate::infra::builtin_workers::builtin_worker("page-reader", PROTOCOL)?;
        let workspace = Workspace::new(CONTAINER)?;
        let limits = Limits {
            memory_bytes: 1024 * 1024 * 1024,
            cpu: Duration::from_secs(super::TIME_LIMIT_SECONDS),
            wall: Duration::from_secs(super::TIME_LIMIT_SECONDS),
            output_bytes: MAX_ANSWER_BYTES as u64,
            // Room for the helper's own copy and the input, which it doesn't write anywhere.
            work_bytes: 64 * 1024 * 1024 + MAX_INPUT_BYTES as u64,
            processes: 1,
        };
        workspace.run(worker, &input, &limits, &stop)
    })
    .await
    .map_err(|_| "the reader stopped".to_owned())?
}

pub(super) fn clean_up() {}

#[cfg(test)]
mod tests {
    use misty_page_reader::protocol::{decode_answer, encode_request};

    #[tokio::test]
    async fn the_confined_worker_reads_a_page() {
        let input =
            encode_request("<html><body><p>Hi</p></body></html>", "text/html", "", 500).unwrap();
        let output = super::run(input).await.unwrap();
        assert_eq!(decode_answer(&output).unwrap().unwrap().text, "Hi");
    }
}
