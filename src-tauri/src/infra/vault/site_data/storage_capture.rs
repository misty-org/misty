//! Reading a site's localStorage from its pages into the records.
use super::engine;
use super::now_ms;
use super::parts::{
    assemble, decide, items_hash, part_id, split, Decision, Known, OriginCopy, LOCAL_STORAGE,
};
use super::scope::{Stored, Unavailable};
use super::storage_sync::{page_origin, StorageSync};
use crate::infra::website_data::storage::{self, PageStorage};
use std::collections::BTreeSet;

impl StorageSync {
    /// Reads the profile's open pages, once per origin. An unchanged origin costs one hash in the
    /// page and sends nothing back.
    pub(super) async fn capture_tabs(&mut self, name: &str, only: Option<&str>) -> Stored<()> {
        self.load(name).await?;
        let store = self.profiles.get(name).ok_or(Unavailable)?.store.clone();
        let mut seen = BTreeSet::new();
        for view in engine::tabs(&self.app, &store) {
            let Some(origin) = page_origin(&view) else {
                continue;
            };
            if only.is_some_and(|only| only != origin) || !seen.insert(origin.clone()) {
                continue;
            }
            let known = self
                .profiles
                .get(name)
                .and_then(|profile| profile.known.get(&origin))
                .map(|known| known.stamp.clone());
            // Navigating or busy: the next pass tries again. Not in this store: left alone.
            let Ok(page) =
                storage::read_page(&view, &store.identity, &origin, known.as_deref()).await
            else {
                continue;
            };
            self.captured(name, &origin, page).await?;
        }
        Ok(())
    }

    /// Takes in what a page reported.
    pub(super) async fn captured(
        &mut self,
        name: &str,
        origin: &str,
        page: PageStorage,
    ) -> Stored<()> {
        if page.unchanged {
            return Ok(());
        }
        if page.too_large {
            return self.over_cap(name, origin, page.stamp).await;
        }
        let Some(items) = page.items else {
            return Ok(());
        };
        let hash = items_hash(&items);
        let record = self.scope_copy(name, origin).await?;
        let known = self
            .profiles
            .get(name)
            .ok_or(Unavailable)?
            .known
            .get(origin)
            .cloned();
        let decision = decide(
            known.as_ref(),
            record
                .as_ref()
                .map(|(edited_at, theirs, _)| (*edited_at, theirs.as_str())),
            &hash,
            items.is_empty(),
            now_ms(),
        );
        let old_parts = record.as_ref().map_or(0, |(_, _, parts)| *parts);
        let remember = match decision {
            Decision::Same => {
                if known.is_none() {
                    return Ok(());
                }
                Known {
                    stamp: page.stamp,
                    ..known.unwrap_or_default()
                }
            }
            Decision::Adopt(edited_at) => Known {
                edited_at,
                hash,
                stamp: page.stamp,
                over: false,
            },
            // The records' copy wins; the scan brings it in. The page's own edits later are newer.
            Decision::Yield => {
                self.rescan(name);
                Known {
                    edited_at: 0,
                    hash,
                    stamp: page.stamp,
                    over: false,
                }
            }
            Decision::Upload(edited_at) => {
                let Ok(mut writes) = split(origin, &items, edited_at) else {
                    return self.over_cap(name, origin, page.stamp).await;
                };
                for part in writes.len()..old_parts {
                    writes.push((part_id(origin, part), None));
                }
                self.scope.write(name, LOCAL_STORAGE, writes).await?;
                Known {
                    edited_at,
                    hash,
                    stamp: page.stamp,
                    over: false,
                }
            }
        };
        let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
        profile.known.insert(origin.to_owned(), remember);
        profile.dirty = true;
        Ok(())
    }

    /// The edit time, hash and part count of the copy of an origin in the records.
    async fn scope_copy(&self, name: &str, origin: &str) -> Stored<Option<(u64, String, usize)>> {
        Ok(self.copy_of(name, origin).await?.map(|copy| {
            let hash = items_hash(&copy.items);
            (copy.edited_at, hash, copy.parts)
        }))
    }

    /// Reads a copy of one origin from the records, part by part.
    pub(super) async fn copy_of(&self, name: &str, origin: &str) -> Stored<Option<OriginCopy>> {
        let first = self
            .scope
            .get(name, LOCAL_STORAGE, &part_id(origin, 0))
            .await?;
        let Some(first) = first else {
            return Ok(None);
        };
        let count = first
            .fields
            .get("parts")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(1) as usize;
        let mut records = vec![first];
        for part in 1..count.min(256) {
            if let Some(record) = self
                .scope
                .get(name, LOCAL_STORAGE, &part_id(origin, part))
                .await?
            {
                records.push(record);
            }
        }
        Ok(assemble(&records).remove(origin))
    }

    /// Over the cap, a site's localStorage doesn't sync: its records go, and Settings names it.
    async fn over_cap(&mut self, name: &str, origin: &str, stamp: String) -> Stored<()> {
        if let Some(record) = self.copy_of(name, origin).await? {
            let writes = (0..record.parts)
                .map(|part| (part_id(origin, part), None))
                .collect();
            self.scope.write(name, LOCAL_STORAGE, writes).await?;
        }
        let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
        profile.known.insert(
            origin.to_owned(),
            Known {
                stamp,
                over: true,
                ..Known::default()
            },
        );
        profile.dirty = true;
        Ok(())
    }
}
