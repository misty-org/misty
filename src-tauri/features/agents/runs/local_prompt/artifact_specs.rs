//! Typed drafts a request can ask for (`aiArtifactSpecs`, `inferredAIArtifactKind`).
use super::request::RunRequest;

/// A kind's prompt and JSON shape.
pub(super) fn artifact_spec(kind: &str) -> Option<(&'static str, &'static str)> {
    match kind {
        "drawing_patch" => Some(("Propose constrained scene operations for the current drawing selection. Preserve unrelated elements. For layout updates, copy the exact selection content hash into base_hash and change only x/y positions of selected elements.", r#"{"base_revision":"...","base_hash":"exact selection content hash","changes":[{"op":"add|update|delete","element_id":"opaque id","element":{"x":0,"y":0}}]}"#)),
        "message_draft" => Some(("Draft a Space message for review. Do not post it.", r#"{"conversation_id":"opaque id","text":"...","reply_to_message_id":"optional opaque id"}"#)),
        "terminal_command" => Some(("Propose commands but do not execute them. Explain exact effects, targets, and rollback; use an opaque terminal scope.", r#"{"terminal_scope_id":"opaque id","commands":[{"command":"...","effect":"...","destructive":false}],"rollback":"..."}"#)),
        "browser_action" => Some(("Propose browser interaction steps but do not navigate, click, type, upload, or submit. Name exact visible effects and require a fresh tab grant.", r#"{"tab_scope_id":"opaque id","steps":[{"action":"navigate|click|type|upload|submit","target":"visible description","value":"reviewable value","effect":"..."}]}"#)),
        "transfer_plan" => Some(("Propose retry or recovery operations for exact transfer identifiers without starting them.", r#"{"transfers":[{"transfer_id":"opaque id","action":"retry|resume|cancel|change_conflict_policy","effect":"..."}]}"#)),
        "extension_action" => Some(("Propose extension installation, configuration, or execution steps with exact extension identifiers, permissions, and effects. Do not run them.", r#"{"extension_id":"...","action":"install|configure|run","permissions":[],"configuration":{},"effect":"..."}"#)),
        "image_edit" => Some(("Propose a non-destructive edit of the image that creates a new version and preserves the original. Put in changes only the fields the edit needs: adjust (each -100 to 100: exposure, brightness, contrast, highlights, shadows, saturation, vibrance, warmth, tint, sharpness, vignette), filter with filter_strength (0 to 100), rotate (a quarter turn), flip, straighten (degrees), crop (fractions 0 to 1 of the turned image), aspect (alone it crops to that shape, centered), resize, and add_marks (pen, line, arrow, rect, ellipse, text, redact, or sticker with a box and a sticker id such as shapes:star or flags:FR; coordinates are fractions of the original's longer side from its top left). Do not claim generative pixel changes.", r##"{"asset_id":"opaque id","instruction":"...","output":"new_version","preserve_original":true,"changes":{"adjust":{"exposure":0},"filter":"none|vivid|dramatic|warm|cool|fade|mono|noir","filter_strength":100,"rotate":"left|right","flip":"horizontal|vertical","straighten":0,"crop":{"x":0,"y":0,"width":1,"height":1},"aspect":"free|original|square|4:3|3:2|16:9","resize":{"scale":1},"add_marks":[{"kind":"arrow","from":{"x":0,"y":0},"to":{"x":0,"y":0},"color":"#ff3b30","size":0.006}]}}"##)),
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
        "notes" if request.selection.is_some() && has(&["rewrite", "improve", "shorten", "expand", "fix", "change"]) => "text_patch",
        "drawings" if has(&["add", "draw", "arrange", "cluster", "move", "diagram"]) => "drawing_patch",
        "space.chat" if has(&["draft", "reply", "write message"]) => "message_draft",
        "terminal" if has(&["run", "execute", "command", "install"]) => "terminal_command",
        "browser" if has(&["click", "navigate", "fill", "submit", "upload", "open page"]) => "browser_action",
        "transfers" if has(&["retry", "resume", "cancel", "recover"]) => "transfer_plan",
        "extensions" if has(&["install", "configure", "run", "enable"]) => "extension_action",
        "photo-editor" if has(&["edit", "enhance", "bright", "contrast", "filter", "warm", "cool", "crop", "rotate", "straighten"]) => "image_edit",
        _ => "",
    }
}
