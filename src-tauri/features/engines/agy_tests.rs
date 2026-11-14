use super::*;
use std::path::PathBuf;

pub(super) fn req(permission: Option<&str>) -> SendRequest {
    SendRequest {
        session_id: None,
        workspace: PathBuf::from("/tmp/ws"),
        prompt: "hi".to_string(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: None,
        effort: None,
        service_tier: None,
        permission: permission.map(str::to_string),
        additional_dirs: Vec::new(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    }
}

fn argv(req: &SendRequest) -> Vec<String> {
    AgyEngine
        .host_command(req, "agy")
        .unwrap()
        .command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn runs_as_an_acp_server_with_the_added_folders() {
    assert!(AgyEngine.drives_own_transport());
    assert_eq!(argv(&req(None)), ["acp"]);
    let mut with_dirs = req(None);
    with_dirs.additional_dirs = vec!["/a".into(), " ".into(), "/a".into(), "/b".into()];
    assert_eq!(
        argv(&with_dirs),
        ["acp", "--add-dir", "/a", "--add-dir", "/b"]
    );
    let built = AgyEngine.host_command(&req(None), "agy").unwrap();
    assert!(built.keep_stdin_open, "the gate answers on the pipe");
}

#[test]
fn takes_images_mcp_and_effort_now() {
    assert!(AgyEngine.supports_images());
    assert!(AgyEngine.supports_mcp());
    assert!(AgyEngine.supports_effort());
}

/// agy 1.5.9's `session/new` modes; Misty offers three of them, never a no-asking one.
#[test]
fn modes_match_the_installed_handshake() {
    let session = serde_json::json!({"modes": {"currentModeId": "default", "availableModes": [
        {"id": "default", "name": "Default", "description": "Ask before edits and commands, per your permission settings."},
        {"id": "accept-edits", "name": "Accept edits", "description": "Approve file edits in the workspace without asking."},
        {"id": "auto", "name": "Auto", "description": "Approve edits and safe commands; ask before irreversible actions."},
        {"id": "plan", "name": "Plan", "description": "Plan carefully before executing a task."}]}});
    let listed: Vec<String> = super::super::models::acp_modes(&session)
        .into_iter()
        .map(|mode| mode.id)
        .collect();
    let adapter: Vec<&str> = AgyEngine.modes().iter().map(|mode| mode.id).collect();
    assert_eq!(adapter, ["default", "accept-edits", "plan"]);
    assert!(adapter.iter().all(|id| listed.iter().any(|l| l == id)));
    assert!(!AgyEngine.supported_permissions().contains(&"bypass"));
    assert_eq!(AgyEngine.resolve_permission(Some("manual")), "manual");
    assert_eq!(AgyEngine.resolve_permission(Some("bypass")), "manual");
}
