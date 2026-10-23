//! The ring of sealed clips in sync: following it for clips from other
//! devices, and placing clips copied here into its oldest slot.

use std::{collections::HashSet, time::Duration};

use misty_browser_sync::{
    crypto::ClipboardKey,
    worker::{ClipboardRow, Phase, WorkerHandle},
};

use super::{clip, payload, CloudStart, CloudStatus, Inner};
use crate::domain::clipboard::ClipboardPayload;
use crate::infra::devices::trust;

/// How many clips the ring keeps (one per slot).
const SLOTS: u8 = misty_browser_sync::collections::CLIPBOARD_SLOTS;
/// Clips copied on other devices up to this long before this device joined
/// are not pasted here: they were already in the ring.
const ARRIVAL_SLACK_MS: i64 = 5_000;

pub(super) struct Session {
    handle: WorkerHandle,
    key: ClipboardKey,
    pub(super) device_id: String,
    device_name: String,
    /// When this device started following the ring.
    joined_at_ms: i64,
}

pub(super) async fn run(inner: std::sync::Arc<Inner>, generation: u64, start: CloudStart) {
    while inner.current(generation) {
        if !trust::effective_policy().clipboard || !trust::self_admitted() {
            close(&inner, CloudStatus::Off);
            tokio::time::sleep(Duration::from_secs(15)).await;
            continue;
        }
        let Some((handle, key)) =
            crate::infra::browser_sync::clipboard_session(&start.account_id).await
        else {
            close(&inner, CloudStatus::Locked);
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        };
        let session = std::sync::Arc::new(Session {
            handle,
            key,
            device_id: start.server_device_id.clone(),
            device_name: start.device_name.clone(),
            joined_at_ms: chrono::Utc::now().timestamp_millis(),
        });
        if let Ok(mut slot) = inner.session.write() {
            *slot = Some(session.clone());
        }
        follow(&inner, generation, &session).await;
        close(&inner, CloudStatus::Unavailable);
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn close(inner: &Inner, status: CloudStatus) {
    if let Ok(mut slot) = inner.session.write() {
        *slot = None;
    }
    inner.set_status(status);
}

/// Follows the ring until the worker stops, the policy turns the clipboard
/// off, or the clipboard restarts.
async fn follow(inner: &Inner, generation: u64, session: &Session) {
    let mut rows = session.handle.clipboard_rows.clone();
    let mut status = session.handle.status.clone();
    loop {
        if !inner.current(generation) || !trust::effective_policy().clipboard {
            return;
        }
        inner.set_status(match status.borrow().phase {
            Phase::Ready | Phase::CatchingUp => CloudStatus::Ready,
            Phase::Connecting => CloudStatus::Connecting,
            Phase::Offline | Phase::Attention => CloudStatus::Unavailable,
            Phase::Stopped => return,
        });
        let current = rows.borrow_and_update().clone();
        absorb(inner, session, &current);
        tokio::select! {
            changed = rows.changed() => if changed.is_err() { return },
            changed = status.changed() => if changed.is_err() { return },
            // Policy changes are not signalled here; look again now and then.
            _ = tokio::time::sleep(Duration::from_secs(30)) => {}
        }
    }
}

/// Opens the ring's rows into the clip history and pastes clips that arrived
/// from other devices since this device joined.
fn absorb(inner: &Inner, session: &Session, rows: &[ClipboardRow]) {
    let mut opened: Vec<(u8, clip::Clip)> = rows
        .iter()
        .filter_map(|row| {
            let body = session.key.open(row.slot, &row.ciphertext).ok()?;
            Some((row.slot, clip::decode(&body).ok()?))
        })
        .collect();
    opened.sort_by(|left, right| {
        right
            .1
            .header
            .created_unix_ms
            .cmp(&left.1.header.created_unix_ms)
    });
    let arrived: Vec<clip::Clip> = {
        let Ok(mut history) = inner.history.lock() else {
            return;
        };
        let known: HashSet<String> = history
            .iter()
            .map(|(_, clip)| clip.header.clip_id.clone())
            .collect();
        if history.len() == opened.len()
            && opened
                .iter()
                .all(|(_, clip)| known.contains(&clip.header.clip_id))
        {
            return;
        }
        let arrived = opened
            .iter()
            .map(|(_, clip)| clip)
            .filter(|clip| {
                !known.contains(&clip.header.clip_id)
                    && clip.header.device_id != session.device_id
                    && clip.header.created_unix_ms >= session.joined_at_ms - ARRIVAL_SLACK_MS
            })
            .cloned()
            .collect();
        *history = opened;
        arrived
    };
    inner.notify();
    if let Some(handler) = inner.handler() {
        // Oldest first, so the newest ends up on the system clipboard.
        for clip in arrived.iter().rev() {
            handler(payload(clip));
        }
    }
}

/// Seals a copy made on this device into the ring's oldest slot.
pub(super) async fn publish(inner: &Inner, session: &Session, copy: ClipboardPayload) {
    let source = clip::Source {
        device_id: &session.device_id,
        device_name: &session.device_name,
    };
    let (clip, body) = match clip::from_payload(&copy, &source, ClipboardKey::capacity()) {
        Ok(fit) => fit,
        Err(clip::ClipError::TooLarge) => {
            inner.set_notice(Some(
                "That image is too large to share with your other devices.",
            ));
            return;
        }
        Err(_) => return,
    };
    let slot = next_slot(inner);
    let Ok(sealed) = session.key.seal(slot, &body) else {
        return;
    };
    if session
        .handle
        .clipboard_publish(slot, sealed)
        .await
        .is_err()
    {
        inner.set_notice(Some("Your copy couldn't be shared. Sync isn't running."));
        return;
    }
    inner.set_notice(None);
    if let Ok(mut history) = inner.history.lock() {
        history.retain(|(existing, _)| *existing != slot);
        history.insert(0, (slot, clip));
    }
    inner.notify();
}

/// An empty slot, or else the one holding the oldest clip.
fn next_slot(inner: &Inner) -> u8 {
    let history = inner
        .history
        .lock()
        .map(|history| history.clone())
        .unwrap_or_default();
    (0..SLOTS)
        .find(|slot| !history.iter().any(|(used, _)| used == slot))
        .or_else(|| {
            history
                .iter()
                .min_by_key(|(_, clip)| clip.header.created_unix_ms)
                .map(|(slot, _)| *slot)
        })
        .unwrap_or(0)
}
