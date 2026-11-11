//! The page script that keeps a copy of the media keys a page registers.

/// Runs before page scripts. Pages register their media keys with
/// `navigator.mediaSession.setActionHandler`, which offers no way to read them
/// back, so this keeps a copy that Misty's player can call.
pub(crate) const MEDIA_SESSION_PAGE_SCRIPT: &str = r#"(() => {
  const session = navigator.mediaSession;
  if (!session || window.__mistyMediaActions) return;
  const actions = new Map();
  Object.defineProperty(window, "__mistyMediaActions", { value: actions });
  const original = session.setActionHandler.bind(session);
  session.setActionHandler = (action, handler) => {
    if (typeof handler === "function") actions.set(action, handler);
    else actions.delete(action);
    return original(action, handler);
  };
})();"#;
