//! Extension page hosts and the Spaces that run each, and each Space's controller.
use super::*;

/// Extension page hosts, with the Spaces that run each extension. The same
/// extension keeps one host in every Space; each Space's controller serves it.
pub(super) fn origins() -> &'static std::sync::RwLock<BTreeMap<String, std::collections::BTreeSet<String>>> {
    static ORIGINS: OnceLock<
        std::sync::RwLock<BTreeMap<String, std::collections::BTreeSet<String>>>,
    > = OnceLock::new();
    ORIGINS.get_or_init(Default::default)
}
pub(super) fn allow_origin(space: &str, host: String) {
    if let Ok(mut origins) = origins().write() {
        origins.entry(host).or_default().insert(space.to_owned());
    }
}
pub(super) fn drop_origin(space: &str, host: &str) {
    if let Ok(mut origins) = origins().write() {
        if let Some(spaces) = origins.get_mut(host) {
            spaces.remove(space);
            if spaces.is_empty() {
                origins.remove(host);
            }
        }
    }
}
pub(super) fn drop_space_origins(space: &str) {
    if let Ok(mut origins) = origins().write() {
        origins.retain(|_, spaces| {
            spaces.remove(space);
            !spaces.is_empty()
        });
    }
}
/// An installation's extension page host, for its account origin.
pub(super) fn installation_origin(account: &str, guid: &str) -> String {
    uuid_for(&format!("{account}:{guid}"))
}
/// The host an installation's pages load from, which is the key `allow_origin`
/// and `drop_origin` use: the origin itself on macOS, the extension ID derived
/// from it on Windows. Dropping by the origin left a removed extension's pages
/// allowed on Windows.
pub(super) fn installation_host(account: &str, guid: &str) -> String {
    page_host(&installation_origin(account, guid)).unwrap_or_default()
}
pub(crate) fn is_extension_url(url: &url::Url) -> bool {
    url.scheme() == EXTENSION_SCHEME
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| origins().read().is_ok_and(|o| o.contains_key(host)))
}
pub(super) fn uuid_for(value: &str) -> String {
    let hash = Sha256::digest(value.as_bytes());
    uuid::Uuid::from_bytes(hash[..16].try_into().unwrap()).to_string()
}
/// The extension controller a Space's host uses. The personal Space keeps the
/// account's controller from before Spaces, and with it every extension's storage.
pub(super) fn controller_id(account: &str, space: &str) -> String {
    if space == crate::infra::space_windows::PERSONAL {
        uuid_for(account)
    } else {
        uuid_for(&format!("{account}:space:{space}"))
    }
}
