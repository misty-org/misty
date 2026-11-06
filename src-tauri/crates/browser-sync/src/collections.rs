//! The names of what a profile keeps as records, each a collection in the local store.
pub const BOOKMARKS: &str = "bookmarks";
pub const TAB_GROUPS: &str = "tab_groups";
/// Browsing history, in hourly batches written by the computer that browsed.
pub const HISTORY: &str = "history";
/// Extension-owned declared sync settings. Native-only, never projected to a renderer.
pub const EXTENSION_SYNC: &str = "extension_sync";
/// Saved website sign-ins. Native-only, never projected to a renderer; the
/// server only ever holds each one sealed with the vault key.
pub const PASSWORDS: &str = "passwords";
/// The profile's installed extensions: store id, version and on/off. Each
/// computer fetches the packages from the store itself. Native-only.
pub const EXTENSIONS: &str = "extensions";
/// Per-site camera, microphone, notification and pop-up choices. Native-only.
pub const SITE_PERMISSIONS: &str = "site_permissions";
/// The default search engine, custom engines and custom bangs.
pub const SEARCH: &str = "search";
/// Finished downloads. The file stays on the computer that downloaded it.
pub const DOWNLOADS: &str = "downloads";
/// The newest finished downloads a profile keeps, like the local list.
pub const MAX_DOWNLOADS: usize = 1_000;
/// The shared clipboard's ring of sealed clips.
pub const CLIPBOARD: &str = "clipboard";
/// How many clips the ring keeps.
pub const CLIPBOARD_SLOTS: u8 = 20;
/// The largest sealed clip the server stores (the same limit on both sides).
pub const CLIPBOARD_MAX_BYTES: usize = 256 * 1024;
