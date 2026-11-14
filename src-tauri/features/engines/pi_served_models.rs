//! The served-model sidecar: the ask bridge extension appends each provider response's
//! `responseId<TAB>model` row to a per-run file, and `message_end` reads it back.
use super::{acp_plan_requested, SendRequest};

/// A sidecar untouched this long belongs to no live run: the extension
/// appends on every provider response, and the reader removes the file when
/// the run settles. Leftovers come from runs the reader never settled (app
/// quit mid-turn, crash).
const SERVED_MODELS_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

fn served_models_dir() -> std::path::PathBuf {
    crate::engines::support::paths::app_home().join("served-models")
}

/// Sidecar path for one run's provider-reported served models.
pub(crate) fn served_models_path(run_id: &str) -> std::path::PathBuf {
    served_models_dir().join(format!("{run_id}.tsv"))
}

/// Whether this launch loads the ask bridge extension, which is what writes
/// the served-model sidecar. Read-only pi runs pass `--no-extensions`, and an
/// omp plan request runs over ACP without it.
pub(crate) fn loads_served_model_bridge(engine: &str, req: &SendRequest) -> bool {
    match engine {
        "omp" => !acp_plan_requested(req),
        "pi" => req.allowed_tools.is_none(),
        _ => false,
    }
}

/// Fresh sidecar path for a run: the directory exists, no stale file sits at
/// the path, and leftovers from unsettled runs are swept once per process.
/// `None` when the directory cannot be created — the run then reports no
/// served model instead of pointing the extension at an unwritable path.
pub(crate) fn prepare_served_models_file(run_id: &str) -> Option<std::path::PathBuf> {
    static SWEEP: std::sync::Once = std::sync::Once::new();
    let dir = served_models_dir();
    std::fs::create_dir_all(&dir).ok()?;
    SWEEP.call_once(|| sweep_stale_served_models(&dir, SERVED_MODELS_STALE_AFTER));
    let path = served_models_path(run_id);
    let _ = std::fs::remove_file(&path);
    Some(path)
}

fn sweep_stale_served_models(dir: &std::path::Path, stale_after: std::time::Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("tsv") {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= stale_after);
        if stale {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Last `responseId<TAB>model` row for `response_id`. The extension may append
/// retries/subagent calls to the same file; the newest matching row wins.
fn parse_served_model_sidecar(text: &str, response_id: &str) -> Option<String> {
    text.lines().rev().find_map(|line| {
        let (id, model) = line.split_once('\t')?;
        (id == response_id && !model.trim().is_empty()).then(|| model.trim().to_string())
    })
}

/// Only a row keyed by this message's own response id is evidence. A message
/// without one (user, tool result, a failed call) adopts nothing: omp's
/// background calls (session title and the like) go through the same
/// observed `fetch`, so a lone row need not belong to this turn.
pub(super) fn served_model_from_sidecar(
    sidecar: Option<&std::path::Path>,
    response_id: Option<&str>,
) -> Option<String> {
    let (sidecar, response_id) = (sidecar?, response_id?);
    let text = std::fs::read_to_string(sidecar).ok()?;
    parse_served_model_sidecar(&text, response_id)
}

#[cfg(test)]
mod tests {
    use super::super::{parse_pi_family_line_with_sidecar, EngineEvent};
    use super::*;

    #[test]
    fn sidecar_returns_the_newest_matching_provider_model() {
        let text = "gen-1\ta/model-old\ngen-2\tb/model\ngen-1\ta/model-new\n";
        assert_eq!(
            parse_served_model_sidecar(text, "gen-1").as_deref(),
            Some("a/model-new")
        );
        assert_eq!(
            parse_served_model_sidecar(text, "gen-2").as_deref(),
            Some("b/model")
        );
        assert_eq!(parse_served_model_sidecar(text, "gen-3"), None);
        assert_eq!(parse_served_model_sidecar("malformed-line\n", "x"), None);
    }

    /// A sidecar under the system temp dir, never the real app home.
    fn temp_sidecar(tag: &str, rows: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ccgui-served-models-{tag}-{}.tsv",
            std::process::id()
        ));
        std::fs::write(&path, rows).unwrap();
        path
    }

    fn message_end_with_sidecar(
        message: serde_json::Value,
        sidecar: &std::path::Path,
    ) -> Vec<EngineEvent> {
        let mut out = Vec::new();
        parse_pi_family_line_with_sidecar(
            &serde_json::json!({ "type": "message_end", "message": message }).to_string(),
            &mut out,
            Some(sidecar),
        );
        out
    }

    fn served_model_of(out: &[EngineEvent]) -> Option<&str> {
        out.iter().find_map(|e| match e {
            EngineEvent::Served {
                model: Some(model), ..
            } => Some(model.as_str()),
            _ => None,
        })
    }

    #[test]
    fn message_end_uses_the_run_sidecar_when_upstream_model_is_absent() {
        let path = temp_sidecar("hit", "gen-sidecar\tdeepseek/deepseek-v4.1-flash-1017\n");
        let out = message_end_with_sidecar(
            serde_json::json!({ "model": "deepseek-v4.1-flash", "responseId": "gen-sidecar" }),
            &path,
        );
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            served_model_of(&out),
            Some("deepseek/deepseek-v4.1-flash-1017"),
            "the provider-reported model must be used as served evidence: {out:?}"
        );
    }

    #[test]
    fn message_end_accepts_snake_case_and_plain_response_ids() {
        // Provider/runtime payloads are not consistent about the field name:
        // the sidecar key is the provider's response id regardless of which
        // spelling the runtime used on the assistant message.
        for field in ["response_id", "id"] {
            let path = temp_sidecar(field, "chatcmpl-1\tserved/model\n");
            let out = message_end_with_sidecar(
                serde_json::json!({ "model": "requested-model", field: "chatcmpl-1" }),
                &path,
            );
            let _ = std::fs::remove_file(&path);
            assert_eq!(
                served_model_of(&out),
                Some("served/model"),
                "message.{field} must key the sidecar lookup: {out:?}"
            );
        }
    }

    #[test]
    fn message_end_without_a_response_id_adopts_no_sidecar_row() {
        // omp's background calls (session title and the like) go through the
        // same observed fetch: a lone row can be one of them, e.g. when the
        // turn's own request failed before any response. A message that does
        // not name its response id — a failed call, a user or tool-result
        // message — therefore adopts nothing.
        let path = temp_sidecar("lone", "gen-title\tvendor/smol-upstream\n");
        let failed = message_end_with_sidecar(
            serde_json::json!({ "role": "assistant", "model": "main-model", "stopReason": "error" }),
            &path,
        );
        let tool_result = message_end_with_sidecar(
            serde_json::json!({ "role": "toolResult", "toolCallId": "call-1" }),
            &path,
        );
        let _ = std::fs::remove_file(&path);
        assert_eq!(served_model_of(&failed), None, "{failed:?}");
        assert_eq!(served_model_of(&tool_result), None, "{tool_result:?}");
    }

    #[test]
    fn message_end_without_a_sidecar_reports_no_served_model() {
        let mut out = Vec::new();
        parse_pi_family_line_with_sidecar(
            &serde_json::json!({
                "type": "message_end",
                "message": { "model": "requested-model", "responseId": "gen-1" }
            })
            .to_string(),
            &mut out,
            None,
        );
        assert_eq!(served_model_of(&out), None, "{out:?}");
    }

    #[test]
    fn sweep_removes_only_stale_sidecars() {
        let dir =
            std::env::temp_dir().join(format!("ccgui-served-models-sweep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sidecar = dir.join("run-1.tsv");
        let other = dir.join("notes.txt");
        std::fs::write(&sidecar, "gen-1\tmodel\n").unwrap();
        std::fs::write(&other, "keep").unwrap();

        sweep_stale_served_models(&dir, std::time::Duration::from_secs(3600));
        assert!(sidecar.exists(), "a fresh sidecar may belong to a live run");

        sweep_stale_served_models(&dir, std::time::Duration::ZERO);
        let swept = !sidecar.exists();
        let kept = other.exists();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(swept, "a sidecar past the threshold is a leftover");
        assert!(kept, "only .tsv sidecars are swept");
    }
}
