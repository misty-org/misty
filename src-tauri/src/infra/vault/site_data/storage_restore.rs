//! Bringing a site's localStorage from the records into the store, a whole origin at a time, and
//! only where no page of it is open.
use super::engine::{self, Store};
use super::parts::{assemble, is_pending, items_hash, Items, Known, LOCAL_STORAGE};
use super::scope::{Stored, Unavailable};
use super::storage_sync::{page_origin, set_held, StorageSync};
use crate::infra::website_data::storage::{self, InertOrigin, StorageError};
use std::collections::BTreeSet;
use std::time::{Duration, Instant};

const RESTORES_AT_ONCE: usize = 4;
const BACKOFF_FIRST: Duration = Duration::from_secs(30);
const BACKOFF_MOST: Duration = Duration::from_secs(1800);

impl StorageSync {
    /// Finds what the records have that this store doesn't, and brings in a little of it.
    pub(super) async fn restore_due(&mut self, name: &str, now: Instant) -> Stored<()> {
        let scope = self.scope;
        let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
        let scanning = profile.scan_at.is_some_and(|at| at <= now);
        // Most wakes have nothing to bring in, and shouldn't ask every tab where it is.
        if !scanning && profile.queue.is_empty() && profile.held.is_empty() {
            return Ok(());
        }
        if scanning {
            // Tried again in a while if the store can't be read now.
            profile.scan_at = Some(now + BACKOFF_FIRST);
            let records = scope.list(name, LOCAL_STORAGE).await?;
            let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
            profile.scan_at = None;
            let known = profile.known.clone();
            // Hashing big copies takes a while, and only their names are kept.
            let pending = tokio::task::spawn_blocking(move || {
                assemble(&records)
                    .into_iter()
                    .filter(|(origin, copy)| is_pending(known.get(origin), copy))
                    .map(|(origin, _)| origin)
                    .collect::<Vec<_>>()
            })
            .await
            .map_err(|_| Unavailable)?;
            profile.queue = pending.into();
            profile.held.clear();
        }
        let store = self.profiles.get(name).ok_or(Unavailable)?.store.clone();
        let tabs: BTreeSet<String> = engine::tabs(&self.app, &store)
            .iter()
            .filter_map(page_origin)
            .collect();
        let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
        // A site whose tabs have closed goes back in line.
        let freed: Vec<String> = profile.held.difference(&tabs).cloned().collect();
        for origin in freed {
            profile.held.remove(&origin);
            profile.queue.push_back(origin);
        }
        let mut batch = Vec::new();
        while batch.len() < RESTORES_AT_ONCE {
            let Some(origin) = profile.queue.pop_front() else {
                break;
            };
            if tabs.contains(&origin) {
                profile.held.insert(origin);
            } else {
                batch.push(origin);
            }
        }
        set_held(name, profile.held.clone());
        let mut failed = false;
        for origin in batch {
            match self.restore(name, &origin, &store).await {
                Ok(()) => {}
                Err(StorageError::Profile) => {}
                Err(StorageError::Unavailable) => failed = true,
            }
        }
        let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
        if failed {
            profile.failures += 1;
            let wait = BACKOFF_FIRST
                .saturating_mul(2u32.saturating_pow(profile.failures.min(8)))
                .min(BACKOFF_MOST);
            profile.scan_at = Some(Instant::now() + wait);
        } else if profile.queue.is_empty() {
            profile.failures = 0;
        }
        Ok(())
    }

    /// Brings an origin's copy into the store through an inert document. What's read back has to
    /// match before it counts; otherwise the old data goes back and it is tried again later.
    async fn restore(
        &mut self,
        name: &str,
        origin: &str,
        store: &Store,
    ) -> Result<(), StorageError> {
        let Some(copy) = self
            .copy_of(name, origin)
            .await
            .map_err(|_| StorageError::Unavailable)?
        else {
            return Ok(());
        };
        let known = self
            .profiles
            .get(name)
            .and_then(|profile| profile.known.get(origin));
        if !is_pending(known, &copy) {
            return Ok(());
        }
        let owner = crate::infra::profile_windows::windows_for_profile(&self.app, name)
            .into_iter()
            .find(|window| crate::infra::profile_windows::is_person_window(window.label()))
            .ok_or(StorageError::Unavailable)?;
        let inert = InertOrigin::open(&owner, &store.identity, origin)
            .await
            .map_err(|_| StorageError::Unavailable)?;
        let view = inert.view();
        let wanted = items_hash(&copy.items);
        let before = storage::read_page(view, &store.identity, origin, None).await?;
        // Over the cap here, it doesn't sync in either direction.
        if before.too_large {
            if let Some(profile) = self.profiles.get_mut(name) {
                profile.known.insert(
                    origin.to_owned(),
                    Known {
                        stamp: before.stamp,
                        over: true,
                        ..Known::default()
                    },
                );
                profile.dirty = true;
            }
            return Ok(());
        }
        let old: Option<Items> = before.items;
        let (stamp, stored) = if old.as_ref().is_some_and(|old| items_hash(old) == wanted) {
            (before.stamp, true)
        } else {
            let after = storage::write_page(view, &store.identity, origin, &copy.items).await?;
            let same = !after.write_failed
                && after
                    .items
                    .as_ref()
                    .is_some_and(|items| items_hash(items) == wanted);
            if !same {
                // Keeps what the site had, and the scan tries again later.
                if let Some(old) = &old {
                    let _ = storage::write_page(view, &store.identity, origin, old).await;
                }
            }
            (after.stamp, same)
        };
        if !stored {
            return Err(StorageError::Unavailable);
        }
        if let Some(profile) = self.profiles.get_mut(name) {
            profile.known.insert(
                origin.to_owned(),
                Known {
                    edited_at: copy.edited_at,
                    hash: wanted,
                    stamp,
                    over: false,
                },
            );
            profile.dirty = true;
        }
        Ok(())
    }

    /// A page of a held site is about to load. Its new data goes in first if the other tabs of
    /// the site allow it, so the page starts from it.
    pub(super) async fn about_to_load(
        &mut self,
        name: &str,
        origin: &str,
        loading: Option<&str>,
    ) -> Stored<()> {
        self.load(name).await?;
        let store = self.profiles.get(name).ok_or(Unavailable)?.store.clone();
        let other_tab = engine::tabs(&self.app, &store).iter().any(|view| {
            Some(view.label()) != loading && page_origin(view).as_deref() == Some(origin)
        });
        if other_tab {
            return Ok(());
        }
        if self.restore(name, origin, &store).await.is_ok() {
            if let Some(profile) = self.profiles.get_mut(name) {
                profile.held.remove(origin);
                set_held(name, profile.held.clone());
            }
        }
        Ok(())
    }
}
