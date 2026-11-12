//! The names of what a profile keeps as records, each a collection in the local store.
pub const TAB_GROUPS: &str = "tab_groups";
/// The profile's installed extensions: store id, version and on/off. Native-only.
pub const EXTENSIONS: &str = "extensions";
/// Per-site camera, microphone, notification and pop-up choices. Native-only.
pub const SITE_PERMISSIONS: &str = "site_permissions";
/// The default search engine, custom engines and custom bangs.
pub const SEARCH: &str = "search";
/// Finished downloads.
pub const DOWNLOADS: &str = "downloads";
/// The newest finished downloads a profile keeps, like the local list.
pub const MAX_DOWNLOADS: usize = 1_000;
