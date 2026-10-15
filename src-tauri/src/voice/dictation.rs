//! Hold-to-talk dictation with a double-tap hands-free lock.
//!
//! Hold the chord to talk and release to finish. Tap it twice quickly to keep
//! listening hands-free; tap once more to finish. A single short tap does
//! nothing, so brushing the key never inserts text.
use std::time::{Duration, Instant};

/// A press shorter than this is a tap, not a hold.
pub const TAP: Duration = Duration::from_millis(250);
/// The second tap of a double-tap must start within this of the first release.
pub const DOUBLE_TAP: Duration = Duration::from_millis(350);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Idle,
    /// The key is held and the microphone is open.
    Holding { since: Instant },
    /// A short tap: keep listening briefly in case a second tap locks it.
    Tapped { released: Instant },
    /// Hands-free: listening until the next press.
    Locked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// Open the microphone and start streaming (with pre-roll).
    Start,
    /// Hands-free is on; show the lock in the pill.
    Lock,
    /// Stop listening, finalize the transcript and insert it.
    Finish,
    /// Stop listening and discard: it was only a tap.
    Cancel,
}

#[derive(Debug)]
pub struct Dictation {
    phase: Phase,
    hands_free: bool,
}

impl Dictation {
    pub fn new(hands_free: bool) -> Self {
        Self { phase: Phase::Idle, hands_free }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn set_hands_free(&mut self, enabled: bool) {
        self.hands_free = enabled;
    }

    pub fn key_down(&mut self, now: Instant) -> Option<Action> {
        match self.phase {
            Phase::Idle => {
                self.phase = Phase::Holding { since: now };
                Some(Action::Start)
            }
            Phase::Tapped { released } if now.duration_since(released) <= DOUBLE_TAP => {
                self.phase = Phase::Locked;
                Some(Action::Lock)
            }
            Phase::Tapped { .. } => {
                // Too late for a double-tap: treat as a fresh hold.
                self.phase = Phase::Holding { since: now };
                None
            }
            Phase::Locked => {
                self.phase = Phase::Idle;
                Some(Action::Finish)
            }
            Phase::Holding { .. } => None,
        }
    }

    pub fn key_up(&mut self, now: Instant) -> Option<Action> {
        match self.phase {
            Phase::Holding { since } if self.hands_free && now.duration_since(since) < TAP => {
                self.phase = Phase::Tapped { released: now };
                None
            }
            Phase::Holding { since } if now.duration_since(since) < TAP => {
                self.phase = Phase::Idle;
                Some(Action::Cancel)
            }
            Phase::Holding { .. } => {
                self.phase = Phase::Idle;
                Some(Action::Finish)
            }
            _ => None,
        }
    }

    /// Call periodically: a lone tap expires into a cancel.
    pub fn tick(&mut self, now: Instant) -> Option<Action> {
        match self.phase {
            Phase::Tapped { released } if now.duration_since(released) > DOUBLE_TAP => {
                self.phase = Phase::Idle;
                Some(Action::Cancel)
            }
            _ => None,
        }
    }

    /// Mute, an error or the window closing: stop without inserting.
    pub fn abort(&mut self) -> Option<Action> {
        (self.phase != Phase::Idle).then(|| {
            self.phase = Phase::Idle;
            Action::Cancel
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn hold_then_release_finishes() {
        let t = Instant::now();
        let mut d = Dictation::new(true);
        assert_eq!(d.key_down(t), Some(Action::Start));
        assert_eq!(d.key_up(at(t, 900)), Some(Action::Finish));
        assert_eq!(d.phase(), Phase::Idle);
    }

    #[test]
    fn double_tap_locks_and_the_next_press_finishes() {
        let t = Instant::now();
        let mut d = Dictation::new(true);
        assert_eq!(d.key_down(t), Some(Action::Start));
        assert_eq!(d.key_up(at(t, 120)), None);
        assert_eq!(d.key_down(at(t, 300)), Some(Action::Lock));
        assert_eq!(d.key_up(at(t, 380)), None);
        assert_eq!(d.tick(at(t, 5000)), None);
        assert_eq!(d.key_down(at(t, 9000)), Some(Action::Finish));
        assert_eq!(d.key_up(at(t, 9100)), None);
    }

    #[test]
    fn a_lone_tap_inserts_nothing() {
        let t = Instant::now();
        let mut d = Dictation::new(true);
        d.key_down(t);
        d.key_up(at(t, 100));
        assert_eq!(d.tick(at(t, 300)), None);
        assert_eq!(d.tick(at(t, 500)), Some(Action::Cancel));
        let mut no_lock = Dictation::new(false);
        no_lock.key_down(t);
        assert_eq!(no_lock.key_up(at(t, 100)), Some(Action::Cancel));
    }

    #[test]
    fn a_slow_second_press_is_a_new_hold() {
        let t = Instant::now();
        let mut d = Dictation::new(true);
        d.key_down(t);
        d.key_up(at(t, 100));
        assert_eq!(d.key_down(at(t, 600)), None);
        assert_eq!(d.key_up(at(t, 1500)), Some(Action::Finish));
    }

    #[test]
    fn abort_cancels_any_live_phase() {
        let mut d = Dictation::new(true);
        assert_eq!(d.abort(), None);
        d.key_down(Instant::now());
        assert_eq!(d.abort(), Some(Action::Cancel));
    }
}
