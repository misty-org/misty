//! The ring of sealed clips: opening what it holds, and sealing clips copied here into its
//! oldest slot. They are records like any other, so the vault link carries them.

use std::{collections::HashSet, time::Duration};

use browser_data::crypto::ClipboardKey;

use super::{clip, CloudStart, CloudStatus, Inner};
use crate::browser::profiles;
use crate::devices::trust;
use crate::sync::clipboard::ClipboardPayload;
use crate::sync::vault;

/// How many clips the ring keeps (one per slot).
const SLOTS: u8 = browser_data::collections::CLIPBOARD_SLOTS;

pub(super) struct Session {
    key: ClipboardKey,
    pub(super) device_id: String,
    device_name: String,
}

pub(super) async fn run(inner: std::sync::Arc<Inner>, generation: u64, start: CloudStart) {
    while inner.current(generation) {
        if !trust::effective_policy().clipboard {
            close(&inner, CloudStatus::Off);
            tokio::time::sleep(Duration::from_secs(15)).await;
            continue;
        }
        let Some(key) = vault::clipboard_key().await else {
            close(&inner, CloudStatus::Locked);
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        };
        let session = std::sync::Arc::new(Session {
            key,
            device_id: start.server_device_id.clone(),
            device_name: start.device_name.clone(),
        });
        if let Ok(mut slot) = inner.session.write() {
            *slot = Some(session);
        }
        inner.set_status(CloudStatus::Ready);
        follow(&inner, generation).await;
    }
}

const COLLECTION: &str = browser_data::collections::CLIPBOARD;
/// How long a clip stays on the ring, on the server and here alike.
const LIFETIME_MS: i64 = 24 * 60 * 60 * 1000;

/// Opens the ring whenever it changes, until the vault closes.
async fn follow(inner: &std::sync::Arc<Inner>, generation: u64) {
    let mut changes = profiles::subscribe();
    loop {
        let Some(session) = inner.session() else {
            return;
        };
        if let Some(records) = vault::clipboard_records() {
            let mut rows = Vec::new();
            for slot in 0..SLOTS {
                if let Ok(Some(sealed)) = records.raw_read(COLLECTION, &slot.to_string()).await {
                    rows.push((slot, sealed));
                }
            }
            absorb(inner, &session, &rows);
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(30)) => {}
            change = changes.recv() => {
                if matches!(&change, Ok(change) if change.collection != COLLECTION) {
                    continue;
                }
            }
        }
        if !inner.current(generation) || vault::clipboard_key().await.is_none() {
            return;
        }
    }
}

fn close(inner: &Inner, status: CloudStatus) {
    if let Ok(mut slot) = inner.session.write() {
        *slot = None;
    }
    inner.set_status(status);
}

/// Opens the ring's rows (slot and sealed clip) into the clip history. Clips from other
/// devices only appear in the list; they never reach the system clipboard.
fn absorb(inner: &Inner, session: &Session, rows: &[(u8, Vec<u8>)]) {
    let mut opened: Vec<(u8, clip::Clip)> = rows
        .iter()
        .filter_map(|(slot, sealed)| {
            let body = session.key.open(*slot, sealed).ok()?;
            let clip = clip::decode(&body).ok()?;
            let age = chrono::Utc::now().timestamp_millis() - clip.header.created_unix_ms;
            (age < LIFETIME_MS).then_some((*slot, clip))
        })
        .collect();
    opened.sort_by(|left, right| {
        right
            .1
            .header
            .created_unix_ms
            .cmp(&left.1.header.created_unix_ms)
    });
    {
        let Ok(mut history) = inner.history.lock() else {
            return;
        };
        let known: HashSet<&str> = history
            .iter()
            .map(|(_, clip)| clip.header.clip_id.as_str())
            .collect();
        if history.len() == opened.len()
            && opened
                .iter()
                .all(|(_, clip)| known.contains(clip.header.clip_id.as_str()))
        {
            return;
        }
        *history = opened;
    }
    inner.notify();
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
    // The same content again is not a new entry: the newest copy of it stays as it is, and an
    // older one moves to the top in its own slot.
    let repeated = inner.history.lock().ok().and_then(|history| {
        history
            .iter()
            .enumerate()
            .find(|(_, (_, existing))| clip::same_content(existing, &clip))
            .map(|(index, (slot, _))| (index, *slot))
    });
    if matches!(repeated, Some((0, _))) {
        return;
    }
    let slot = repeated.map_or_else(|| next_slot(inner), |(_, slot)| slot);
    let Ok(sealed) = session.key.seal(slot, &body) else {
        return;
    };
    let published = match vault::clipboard_records() {
        Some(records) => records
            .raw_write(COLLECTION, &slot.to_string(), Some(sealed))
            .await
            .is_ok(),
        None => false,
    };
    if !published {
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
