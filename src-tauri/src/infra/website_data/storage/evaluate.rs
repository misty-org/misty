//! Running the storage script in a page and reading its answer.
use super::*;

/// The script world storage runs in, shared by no other Misty code.
const WORLD: &str = "misty-site-storage";
/// The script refuses to return more than 8 MiB of items; this leaves room for its envelope.
const MAX_ANSWER: usize = (8 << 20) + (64 << 10);

/// One origin's localStorage as a page reported it.
#[derive(Deserialize)]
pub(crate) struct PageStorage {
    /// A hash of everything in the origin, so a later read can skip sending it.
    pub stamp: String,
    /// `None` when it is unchanged, or too large to sync.
    pub items: Option<BTreeMap<String, String>>,
    pub unchanged: bool,
    pub too_large: bool,
    pub write_failed: bool,
    origin: String,
}

/// Why a page's storage could not be read. Fixed values, so no page text can reach a log.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StorageError {
    /// The view isn't in the store it should be in: it is left alone.
    Profile,
    /// Navigating, busy or gone. The next pass tries again.
    Unavailable,
}

/// Reads an origin's storage from a page of it. `known` is the stamp already held.
pub(crate) async fn read_page(
    view: &Webview,
    physical: &str,
    origin: &str,
    known: Option<&str>,
) -> Result<PageStorage, StorageError> {
    evaluate(
        view,
        physical,
        origin,
        json!({"origin": origin, "known": known}),
    )
    .await
}

/// Replaces an origin's storage. The answer is what the page holds afterwards.
pub(crate) async fn write_page(
    view: &Webview,
    physical: &str,
    origin: &str,
    items: &BTreeMap<String, String>,
) -> Result<PageStorage, StorageError> {
    evaluate(
        view,
        physical,
        origin,
        json!({"origin": origin, "write": items}),
    )
    .await
}

async fn evaluate(
    view: &Webview,
    physical: &str,
    origin: &str,
    request: Value,
) -> Result<PageStorage, StorageError> {
    let url = view.url().map_err(|_| StorageError::Unavailable)?;
    if url.origin().ascii_serialization() != origin {
        return Err(StorageError::Unavailable);
    }
    // Verify the real store, never just what the view says about itself.
    super::super::cookie_store::verify_store(view, physical)
        .await
        .map_err(|_| StorageError::Profile)?;
    // A JSON string parsed in the page: as object source, a `__proto__` key would be lost.
    let request = serde_json::to_string(&request).map_err(|_| StorageError::Unavailable)?;
    let request = serde_json::to_string(&request).map_err(|_| StorageError::Unavailable)?;
    let script = SCRIPT.replacen("__MISTY_STORAGE_REQUEST__", &request, 1);
    let raw =
        crate::infra::browser_content_world::evaluate_in_content_world(view.clone(), WORLD, script)
            .await
            .map_err(|_| StorageError::Unavailable)?;
    let raw = zeroize::Zeroizing::new(raw);
    if raw.len() > MAX_ANSWER {
        return Err(StorageError::Unavailable);
    }
    let answer: PageStorage = serde_json::from_str(&raw).map_err(|_| StorageError::Unavailable)?;
    if answer.origin != origin {
        return Err(StorageError::Unavailable);
    }
    Ok(answer)
}

/// Whether an inert origin document has finished opening. The title is the DOM's, so Misty's
/// world can read what the page's world wrote.
pub(super) async fn ready(view: &Webview, origin: &str) -> bool {
    let script = format!(
        "return location.origin === {} && document.title === 'Misty storage' ? 'ready' : '';",
        serde_json::to_string(origin).unwrap_or_default()
    );
    crate::infra::browser_content_world::evaluate_in_content_world(view.clone(), WORLD, script)
        .await
        .is_ok_and(|answer| answer == "ready")
}
