//! A profile's open tabs, one record per tab strip entry. Sync tracks what's in the profile, never
//! windows: which window holds a tab is this computer's own business, kept here.
//!
//! Each window says which tabs it holds and which it changed. A tab that left a window is only
//! gone if no other window claims it a moment later, so dragging one between windows isn't closing
//! it. Closing a window says nothing at all: its tabs stay in the profile.
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::time::Duration;

use misty_browser_sync::document::entities::{Fields, Kind};
use serde::{Deserialize, Serialize};

use super::*;

pub const TABS: &str = "tabs";
/// How long a tab may be in nobody's window before it counts as closed.
const CLAIM_WAIT: Duration = Duration::from_secs(2);
const MAX_TABS_PER_CALL: usize = 5_000;

/// Tabs that left a window and aren't closed yet, with the window they left. Until then nothing
/// may hand them back as if new, or a tab being closed reappears and is saved again.
static LEAVING: Mutex<BTreeMap<(String, String), String>> = Mutex::new(BTreeMap::new());

fn leaving_from(profile: &str) -> BTreeSet<String> {
    LEAVING.lock().map_or_else(
        |_| BTreeSet::new(),
        |leaving| {
            leaving
                .keys()
                .filter(|(owner, _)| owner == profile)
                .map(|(_, id)| id.clone())
                .collect()
        },
    )
}

/// Which open window holds each tab, per profile. Kept in the store's meta, never synced.
fn owners_key(profile: &str) -> String {
    format!("tabs.owners.{profile}")
}

fn read_owners(store: &LocalStore, profile: &str) -> BTreeMap<String, String> {
    store
        .meta(&owners_key(profile))
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_owners(store: &LocalStore, profile: &str, owners: &BTreeMap<String, String>) {
    if let Ok(text) = serde_json::to_string(owners) {
        let _ = store.set_meta(&owners_key(profile), &text);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabRecord {
    pub id: String,
    pub fields: Fields,
}

/// What a window should reconcile against.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabsForWindow {
    /// The tabs this window holds, including ones that just arrived from elsewhere.
    pub tabs: Vec<TabRecord>,
    /// Of the tabs it listed, those closed elsewhere.
    pub removed: Vec<String>,
}

/// Works out which tabs belong to `window`: those it holds, plus any no open window holds. A tab
/// owned by a window that's gone is up for grabs. `open_windows` lists the profile's open windows.
pub(super) fn assign(
    owners: &mut BTreeMap<String, String>,
    tab_ids: &[String],
    window: &str,
    claims_new: bool,
    open_windows: &BTreeSet<String>,
) -> Vec<String> {
    let mut mine = Vec::new();
    let mut live = BTreeSet::new();
    for id in tab_ids {
        live.insert(id.clone());
        let holder = owners.get(id).filter(|owner| open_windows.contains(*owner));
        match holder {
            Some(owner) if owner == window => mine.push(id.clone()),
            Some(_) => {}
            None if claims_new => {
                owners.insert(id.clone(), window.to_owned());
                mine.push(id.clone());
            }
            None => {}
        }
    }
    owners.retain(|id, _| live.contains(id));
    mine
}

fn calling_window(webview: &tauri::Webview) -> Result<(String, String, String), String> {
    let label = webview.window().label().to_owned();
    if !profile_windows::is_person_window(&label) {
        return Err("Only a profile's own windows sync their tabs.".into());
    }
    let state = profile_windows::window_state(&label).ok_or("This window has no profile.")?;
    Ok((label, state.profile, state.window_id))
}

/// Whether new tabs from elsewhere should land in this window: the one last used in the profile.
fn takes_new_tabs(label: &str, profile: &str) -> bool {
    let mine = |other: &str| profile_windows::profile_for_window(other).as_deref() == Some(profile);
    match profile_windows::last_person_window() {
        Some(last) if mine(&last) => last == label,
        _ => profile_windows::first_window_of(profile).as_deref() == Some(label),
    }
}

/// The tabs this window should show now. `local` is what it holds at the moment, so it can be told
/// which of those were closed elsewhere.
#[tauri::command]
pub async fn profile_tabs_sync(
    webview: tauri::Webview,
    local: Vec<String>,
) -> Result<TabsForWindow, String> {
    let (label, profile, window) = calling_window(&webview)?;
    if local.len() > MAX_TABS_PER_CALL {
        return Err("Too many tabs at once.".into());
    }
    let open = profile_windows::open_window_ids(&profile);
    let claims_new = takes_new_tabs(&label, &profile);
    let store = local_store()?;
    tokio::task::spawn_blocking(move || {
        let store = store.lock().map_err(|_| "Local storage is unavailable.")?;
        let records = store
            .list(&profile, TABS)
            .map_err(|_| "Local storage is unavailable.")?;
        let mut owners = read_owners(&store, &profile);
        let ids: Vec<String> = records.iter().map(|record| record.id.clone()).collect();
        // A tab the window already shows is its own, whoever held it last.
        for id in &local {
            if ids.contains(id) && !owners.get(id).is_some_and(|owner| open.contains(owner)) {
                owners.insert(id.clone(), window.clone());
            }
        }
        let leaving = leaving_from(&profile);
        let mine: BTreeSet<String> = assign(&mut owners, &ids, &window, claims_new, &open)
            .into_iter()
            .filter(|id| !leaving.contains(id))
            .collect();
        write_owners(&store, &profile, &owners);
        let tombstones: BTreeSet<String> = store
            .deleted_ids(&profile, TABS)
            .map_err(|_| "Local storage is unavailable.")?
            .into_iter()
            .collect();
        Ok(TabsForWindow {
            tabs: records
                .into_iter()
                .filter(|record| record.kind == Kind::OpenTab && mine.contains(&record.id))
                .map(|record| TabRecord {
                    id: record.id,
                    fields: record.fields,
                })
                .collect(),
            removed: local
                .into_iter()
                .filter(|id| tombstones.contains(id))
                .collect(),
        })
    })
    .await
    .map_err(|_| "Local storage is unavailable.".to_owned())?
}

/// Saves what a window holds. `present` is every tab in it; `changed` only those that differ from
/// what it last sent or received. A saved copy that hasn't changed can't bring back a tab someone
/// closed elsewhere. A tab that left is closed unless another window claims it soon.
#[tauri::command]
pub async fn profile_tabs_publish(
    webview: tauri::Webview,
    present: Vec<String>,
    changed: Vec<TabRecord>,
) -> Result<(), String> {
    let (_, profile, window) = calling_window(&webview)?;
    if present.len() > MAX_TABS_PER_CALL || changed.len() > MAX_TABS_PER_CALL {
        return Err("Too many tabs at once.".into());
    }
    let store = local_store()?;
    let (left, writes) = {
        let store = store.lock().map_err(|_| "Local storage is unavailable.")?;
        let mut owners = read_owners(&store, &profile);
        let present: BTreeSet<String> = present.into_iter().collect();
        let left: Vec<String> = owners
            .iter()
            .filter(|(id, owner)| **owner == window && !present.contains(*id))
            .map(|(id, _)| id.clone())
            .collect();
        for id in &present {
            owners.insert(id.clone(), window.clone());
        }
        write_owners(&store, &profile, &owners);
        if let Ok(mut leaving) = LEAVING.lock() {
            for id in &present {
                leaving.remove(&(profile.clone(), id.clone()));
            }
            for id in &left {
                leaving.insert((profile.clone(), id.clone()), window.clone());
            }
        }
        let writes: Vec<(String, Option<ViewRecord>)> = changed
            .into_iter()
            .filter(|tab| present.contains(&tab.id))
            .map(|tab| {
                let record = ViewRecord {
                    kind: Kind::OpenTab,
                    id: tab.id.clone(),
                    fields: tab.fields,
                };
                (tab.id, Some(record))
            })
            .collect();
        (left, writes)
    };
    let records = ProfileRecords {
        profile: profile.clone(),
        store: store.clone(),
    };
    if !writes.is_empty() {
        records.records_write(TABS, writes).await?;
    }
    if !left.is_empty() {
        tauri::async_runtime::spawn(close_unclaimed(records, window, left));
    }
    Ok(())
}

/// Tabs that left `window`: closed for everyone, unless another window has claimed them by now or
/// this one has taken them back.
async fn close_unclaimed(records: ProfileRecords, window: String, left: Vec<String>) {
    tokio::time::sleep(CLAIM_WAIT).await;
    let closed: Vec<String> = {
        let Ok(store) = records.store.lock() else {
            return;
        };
        let mut owners = read_owners(&store, &records.profile);
        // A window that holds it again took it off this list.
        let still_leaving = |id: &String| {
            LEAVING.lock().is_ok_and(|mut leaving| {
                let key = (records.profile.clone(), id.clone());
                leaving.get(&key) == Some(&window) && leaving.remove(&key).is_some()
            })
        };
        let closed: Vec<String> = left.into_iter().filter(still_leaving).collect();
        for id in &closed {
            owners.remove(id);
        }
        write_owners(&store, &records.profile, &owners);
        closed
    };
    if closed.is_empty() {
        return;
    }
    // Saved page state goes with the tab; it has no use without it.
    let views: Vec<String> = match records.records_list(TABS).await {
        Ok(listed) => listed
            .iter()
            .filter(|record| closed.contains(&record.id))
            .flat_map(view_ids)
            .collect(),
        Err(_) => Vec::new(),
    };
    let writes = closed.into_iter().map(|id| (id, None)).collect();
    let _ = records.records_write(TABS, writes).await;
    for view in views {
        for slot in ["state", "history"] {
            let _ = records
                .raw_write(PAGE_STATE, &format!("{view}:{slot}"), None)
                .await;
        }
    }
}

fn view_ids(record: &ViewRecord) -> Vec<String> {
    record
        .fields
        .get("views")
        .and_then(|views| views.as_array())
        .map(|views| {
            views
                .iter()
                .filter_map(|view| view.get("id")?.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn windows(values: &[&str]) -> BTreeSet<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn new_tabs_land_in_the_window_that_takes_them() {
        let mut owners = BTreeMap::new();
        let open = windows(&["a", "b"]);
        assert_eq!(
            assign(&mut owners, &ids(&["t"]), "b", false, &open),
            ids(&[])
        );
        assert!(owners.is_empty());
        assert_eq!(
            assign(&mut owners, &ids(&["t"]), "a", true, &open),
            ids(&["t"])
        );
        assert_eq!(
            assign(&mut owners, &ids(&["t"]), "b", true, &open),
            ids(&[])
        );
        assert_eq!(
            assign(&mut owners, &ids(&["t"]), "a", false, &open),
            ids(&["t"])
        );
    }

    #[test]
    fn a_tab_held_by_a_window_that_is_gone_is_up_for_grabs() {
        let mut owners = BTreeMap::from([("t".to_owned(), "gone".to_owned())]);
        assert_eq!(
            assign(&mut owners, &ids(&["t"]), "a", true, &windows(&["a"])),
            ids(&["t"])
        );
        assert_eq!(owners["t"], "a");
    }

    #[test]
    fn a_tab_closed_elsewhere_stops_being_tracked() {
        let mut owners = BTreeMap::from([("t".to_owned(), "a".to_owned())]);
        assert_eq!(
            assign(&mut owners, &[], "a", true, &windows(&["a"])),
            ids(&[])
        );
        assert!(owners.is_empty());
    }

    #[test]
    fn a_tab_being_closed_is_listed_for_its_profile_only() {
        let key = ("leaving-test".to_owned(), "t".to_owned());
        LEAVING.lock().unwrap().insert(key.clone(), "a".to_owned());
        assert_eq!(leaving_from("leaving-test"), windows(&["t"]));
        assert_eq!(leaving_from("another-profile"), windows(&[]));
        LEAVING.lock().unwrap().remove(&key);
        assert_eq!(leaving_from("leaving-test"), windows(&[]));
    }

    #[test]
    fn views_of_a_tab_are_found_for_cleanup() {
        let record = ViewRecord {
            kind: Kind::OpenTab,
            id: "t".into(),
            fields: serde_json::from_value(serde_json::json!({
                "views": [{"id": "v1"}, {"id": "v2"}, {"other": 1}]
            }))
            .unwrap(),
        };
        assert_eq!(view_ids(&record), ids(&["v1", "v2"]));
    }
}
