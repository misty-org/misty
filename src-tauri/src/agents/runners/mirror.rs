//! Forwards a tool's events to the server as the delegated run's events, so
//! the chat's live stream, replay, progress lines and checklist work the same
//! for a coding tool as for Misty's own runs. Each event carries a sequence
//! number; the server stores it once, so a resent batch never duplicates.
use serde::Serialize;

use super::events::RunnerEvent;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MirroredEvent {
    pub seq: u64,
    #[serde(flatten)]
    pub event: RunnerEvent,
}

/// Buffers events between posts. Consecutive text deltas merge into one so a
/// fast tool doesn't post a request per token.
#[derive(Debug, Default)]
pub struct Mirror {
    next_seq: u64,
    pending: Vec<MirroredEvent>,
}

impl Mirror {
    pub fn push(&mut self, event: RunnerEvent) {
        if let (
            RunnerEvent::Delta { text },
            Some(MirroredEvent {
                event: RunnerEvent::Delta { text: last },
                ..
            }),
        ) = (&event, self.pending.last_mut())
        {
            last.push_str(text);
            return;
        }
        // A newer todo list replaces one not yet sent.
        if matches!(event, RunnerEvent::Todos { .. }) {
            self.pending
                .retain(|item| !matches!(item.event, RunnerEvent::Todos { .. }));
        }
        self.next_seq += 1;
        self.pending.push(MirroredEvent {
            seq: self.next_seq,
            event,
        });
    }

    /// Takes the events to post, oldest first.
    pub fn drain(&mut self) -> Vec<MirroredEvent> {
        std::mem::take(&mut self.pending)
    }

    /// Puts back a batch the server didn't accept, ahead of newer events.
    pub fn requeue(&mut self, mut batch: Vec<MirroredEvent>) {
        batch.append(&mut self.pending);
        self.pending = batch;
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}
