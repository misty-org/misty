use std::{collections::HashMap, sync::Mutex};

use crate::{lock, model::now_ms, ItemId, Kind, SpaceId};

pub const QUIET_MS: i64 = 60_000;
pub const SMALLEST_LIMIT: u64 = 20;
pub const LARGEST_LIMIT: u64 = 1_000;
const KEPT: usize = 8;

#[derive(Clone, Debug)]
pub struct Burst {
    pub id: String,
    pub space: SpaceId,
    last_ms: i64,
    limit: u64,
    files: u64,
    pub items: Vec<ItemId>,
    pub held: bool,
}

pub enum Verdict {
    Go,
    Held,
    Stopped { files: u64, burst: String },
}

#[derive(Default)]
pub struct Guard {
    open: Mutex<HashMap<SpaceId, Burst>>,
    ended: Mutex<Vec<Burst>>,
}

impl Guard {
    pub fn check(&self, space: &SpaceId, files: u64, space_files: u64) -> Verdict {
        let now = now_ms();
        let mut open = lock(&self.open);
        if let Some(burst) = open.get(space) {
            if now - burst.last_ms > QUIET_MS {
                let ended = open.remove(space).expect("checked above");
                self.keep(ended);
            }
        }
        let burst = open.entry(space.clone()).or_insert_with(|| Burst {
            id: uuid::Uuid::new_v4().to_string(),
            space: space.clone(),
            last_ms: now,
            limit: (space_files / 2).clamp(SMALLEST_LIMIT, LARGEST_LIMIT),
            files: 0,
            items: Vec::new(),
            held: false,
        });
        burst.last_ms = now;
        if burst.held {
            return Verdict::Held;
        }
        if burst.files + files.max(1) > burst.limit {
            burst.held = true;
            return Verdict::Stopped {
                files: burst.files,
                burst: burst.id.clone(),
            };
        }
        Verdict::Go
    }

    pub fn record(&self, space: &SpaceId, id: &ItemId, files: u64) {
        if let Some(burst) = lock(&self.open).get_mut(space) {
            burst.files += files.max(1);
            burst.items.push(id.clone());
        }
    }

    pub fn take(&self, space: &SpaceId, burst: &str) -> Vec<ItemId> {
        let mut open = lock(&self.open);
        if open.get(space).is_some_and(|open| open.id == burst) {
            let taken = open.remove(space).expect("checked above");
            return taken.items.into_iter().rev().collect();
        }
        drop(open);
        let mut ended = lock(&self.ended);
        match ended
            .iter()
            .position(|kept| kept.space == *space && kept.id == burst)
        {
            Some(index) => ended.remove(index).items.into_iter().rev().collect(),
            None => Vec::new(),
        }
    }

    fn keep(&self, burst: Burst) {
        if burst.items.is_empty() {
            return;
        }
        let mut ended = lock(&self.ended);
        ended.push(burst);
        let extra = ended.len().saturating_sub(KEPT);
        ended.drain(..extra);
    }
}

pub fn files_in(nodes: &[crate::store::NodeRow]) -> u64 {
    nodes.iter().filter(|node| node.kind == Kind::File).count() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space() -> SpaceId {
        SpaceId("space".into())
    }

    #[test]
    fn a_burst_stops_past_half_the_space() {
        let guard = Guard::default();
        for _ in 0..50 {
            assert!(matches!(guard.check(&space(), 1, 100), Verdict::Go));
            guard.record(&space(), &ItemId::new(), 1);
        }
        assert!(matches!(
            guard.check(&space(), 1, 100),
            Verdict::Stopped { files: 50, .. }
        ));
        assert!(matches!(guard.check(&space(), 1, 100), Verdict::Held));
    }

    #[test]
    fn a_small_space_can_be_cleared() {
        let guard = Guard::default();
        for _ in 0..10 {
            assert!(matches!(guard.check(&space(), 1, 10), Verdict::Go));
            guard.record(&space(), &ItemId::new(), 1);
        }
    }

    #[test]
    fn a_big_folder_counts_as_its_files() {
        let guard = Guard::default();
        assert!(matches!(
            guard.check(&space(), 80, 100),
            Verdict::Stopped { files: 0, .. }
        ));
    }

    #[test]
    fn undo_gives_the_newest_first_once() {
        let guard = Guard::default();
        let (first, second) = (ItemId::new(), ItemId::new());
        let Verdict::Go = guard.check(&space(), 1, 100) else {
            panic!()
        };
        guard.record(&space(), &first, 1);
        let Verdict::Go = guard.check(&space(), 1, 100) else {
            panic!()
        };
        guard.record(&space(), &second, 1);
        let id = lock(&guard.open).get(&space()).unwrap().id.clone();
        assert_eq!(guard.take(&space(), &id), vec![second, first]);
        assert!(guard.take(&space(), &id).is_empty());
    }
}
