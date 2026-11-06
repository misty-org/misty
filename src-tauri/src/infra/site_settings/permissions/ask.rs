//! Asks in Misty's site-information popup instead of the engine's own dialog. The engine's
//! decision waits here until the person answers, and a choice for the tab's own site is saved,
//! so it asks once.
use super::{inspect, require_host, target, Decision, Permissions};
use kiri::engine::{AskAnswer, PermissionAsk};
use kiri::permissions::PermissionKind;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Webview};

/// How long a question stays open. A tab left in the background refuses after this, unsaved.
const ASK_EXPIRES: Duration = Duration::from_secs(120);

struct Pending {
    /// The tab's runtime id, as `browser_site_info` takes it.
    tab: String,
    origin: String,
    top_origin: String,
    kinds: Vec<PermissionKind>,
    /// A page can ask again while the question is open; one answer settles them all.
    answers: Vec<AskAnswer>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskEvent {
    request_id: u64,
    id: String,
    origin: String,
    top_origin: String,
    kinds: Vec<PermissionKind>,
}

fn pending() -> &'static Mutex<HashMap<u64, Pending>> {
    static PENDING: OnceLock<Mutex<HashMap<u64, Pending>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

/// Holds the decision and asks the tab's window. Runs on the main thread, as the engine raised it.
pub(super) fn ask(app: &AppHandle, request: PermissionAsk, answer: AskAnswer) {
    let (Some(tab), Some(origin), Some(top_origin)) = (
        request
            .webview
            .strip_prefix("misty-browser-")
            .map(str::to_owned),
        request.requester_origin,
        request.top_origin,
    ) else {
        // No tab to ask in, or origins that can't be named: dropping the answer refuses.
        return;
    };
    if request.kinds.is_empty() {
        return;
    }
    let Ok(mut held) = pending().lock() else {
        return;
    };
    if let Some(open) = held
        .values_mut()
        .find(|open| open.tab == tab && open.origin == origin && open.kinds == request.kinds)
    {
        open.answers.push(answer);
        return;
    }
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let request_id = NEXT.fetch_add(1, Ordering::Relaxed);
    let event = AskEvent {
        request_id,
        id: tab.clone(),
        origin: origin.clone(),
        top_origin: top_origin.clone(),
        kinds: request.kinds.clone(),
    };
    held.insert(
        request_id,
        Pending {
            tab: tab.clone(),
            origin,
            top_origin,
            kinds: request.kinds,
            answers: vec![answer],
        },
    );
    drop(held);
    let owner = crate::infra::browser::browser_owner_label(app, &tab);
    let _ = app.emit_to(owner, "misty://browser-permission-ask", event);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(ASK_EXPIRES).await;
        if let Some(open) = take(request_id) {
            settle(&app, open, false);
        }
    });
}

fn take(request_id: u64) -> Option<Pending> {
    pending().lock().ok()?.remove(&request_id)
}

/// The engine's handlers are only touched on the main thread.
fn settle(app: &AppHandle, open: Pending, allow: bool) {
    let answers = open.answers;
    let _ = app.run_on_main_thread(move || {
        for answer in answers {
            answer.answer(allow);
        }
    });
}

fn with_decision(
    mut permissions: Permissions,
    kinds: &[PermissionKind],
    decision: Decision,
) -> Permissions {
    for kind in kinds {
        match kind {
            PermissionKind::Camera => permissions.camera = decision,
            PermissionKind::Microphone => permissions.microphone = decision,
            PermissionKind::Location => permissions.location = decision,
        }
    }
    permissions
}

/// The person's answer. `ask` means they closed the popup: this request is refused and nothing is
/// saved. An embedded frame's answer is never saved either, as an allowance for it would still be
/// asked next time.
#[tauri::command]
pub async fn browser_site_permission_answer(
    caller: Webview,
    app: AppHandle,
    request_id: u64,
    decision: Decision,
) -> Result<(), String> {
    require_host(&caller)?;
    let Some(open) = take(request_id) else {
        return Ok(());
    };
    let saved = if decision != Decision::Ask && open.origin == open.top_origin {
        save(&app, &open.tab, &open.top_origin, &open.kinds, decision).await
    } else {
        Ok(())
    };
    settle(&app, open, decision == Decision::Allow && saved.is_ok());
    saved
}

async fn save(
    app: &AppHandle,
    tab: &str,
    origin: &str,
    kinds: &[PermissionKind],
    decision: Decision,
) -> Result<(), String> {
    let view = target(app, tab)?;
    let origin = Some(origin.to_owned());
    let current = inspect(app, view.clone(), origin.clone(), None).await?;
    let update = with_decision(current.permissions, kinds, decision);
    inspect(app, view, origin, Some(update)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_decision_changes_only_what_was_asked() {
        let start = Permissions {
            camera: Decision::Block,
            microphone: Decision::Ask,
            location: Decision::Ask,
        };
        let allowed = with_decision(start, &[PermissionKind::Location], Decision::Allow);
        assert_eq!(allowed.location, Decision::Allow);
        assert_eq!(allowed.camera, Decision::Block);
        assert_eq!(allowed.microphone, Decision::Ask);
    }

    #[test]
    fn a_call_for_camera_and_microphone_answers_both() {
        let both = with_decision(
            Permissions::default(),
            &[PermissionKind::Camera, PermissionKind::Microphone],
            Decision::Block,
        );
        assert_eq!(both.camera, Decision::Block);
        assert_eq!(both.microphone, Decision::Block);
        assert_eq!(both.location, Decision::Ask);
    }
}
