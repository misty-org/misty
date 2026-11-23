use super::request::RunRequest;

pub(super) fn artifact_spec(kind: &str) -> Option<(&'static str, &'static str)> {
    match kind {
        "message_draft" => Some(("Draft a Space message for review. Do not post it.", r#"{"conversation_id":"opaque id","text":"...","reply_to_message_id":"optional opaque id"}"#)),
        "terminal_command" => Some(("Propose commands but do not execute them. Explain exact effects, targets, and rollback; use an opaque terminal scope.", r#"{"terminal_scope_id":"opaque id","commands":[{"command":"...","effect":"...","destructive":false}],"rollback":"..."}"#)),
        "browser_action" => Some(("Propose browser interaction steps but do not navigate, click, type, upload, or submit. Name exact visible effects and require a fresh tab grant.", r#"{"tab_scope_id":"opaque id","steps":[{"action":"navigate|click|type|upload|submit","target":"visible description","value":"reviewable value","effect":"..."}]}"#)),
        "transfer_plan" => Some(("Propose retry or recovery operations for exact transfer identifiers without starting them.", r#"{"transfers":[{"transfer_id":"opaque id","action":"retry|resume|cancel|change_conflict_policy","effect":"..."}]}"#)),
        "extension_action" => Some(("Propose extension installation, configuration, or execution steps with exact extension identifiers, permissions, and effects. Do not run them.", r#"{"extension_id":"...","action":"install|configure|run","permissions":[],"configuration":{},"effect":"..."}"#)),
        _ => None,
    }
}

pub(super) fn inferred_artifact_kind(request: &RunRequest) -> &'static str {
    let prompt = request.prompt.trim().to_lowercase();
    if prompt.is_empty() {
        return "";
    }
    let has = |words: &[&str]| words.iter().any(|word| prompt.contains(word));
    match request.surface_id.as_str() {
        "space.chat" if has(&["draft", "reply", "write message"]) => "message_draft",
        "terminal" if has(&["run", "execute", "command", "install"]) => "terminal_command",
        "browser" if has(&["click", "navigate", "fill", "submit", "upload", "open page"]) => {
            "browser_action"
        }
        "transfers" if has(&["retry", "resume", "cancel", "recover"]) => "transfer_plan",
        "extensions" if has(&["install", "configure", "run", "enable"]) => "extension_action",
        _ => "",
    }
}
