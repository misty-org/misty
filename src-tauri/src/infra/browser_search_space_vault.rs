//! The `search` collection of a Space's vault: its default engine, custom
//! engines and custom `!bangs`.
use crate::infra::browser_sync::{space_vault, window_space};
use misty_browser_sync::{
    collections::SEARCH,
    document::{
        entities::{Kind, SearchBang, SearchDefault, SearchEngine},
        ViewRecord,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The engine a Space searches with until someone picks another.
const DEFAULT_ENGINE: &str = "google";
const DEFAULT_ID: &str = "default";
const NO_SPACE: &str = "Turn on sync to keep search shortcuts with this Space.";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Bang {
    pub trigger: String,
    pub name: String,
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomEngine {
    id: String,
    name: String,
    search: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceSearch {
    space_id: Option<String>,
    engine: String,
    engines: Vec<CustomEngine>,
    bangs: Vec<Bang>,
}

fn fields<T: Serialize>(value: &T) -> Option<misty_browser_sync::document::entities::Fields> {
    match serde_json::to_value(value) {
        Ok(Value::Object(fields)) => Some(fields.into_iter().collect()),
        _ => None,
    }
}

fn parse<T: for<'de> Deserialize<'de>>(record: &ViewRecord) -> Option<T> {
    serde_json::from_value(Value::Object(record.fields.clone().into_iter().collect())).ok()
}

fn bang_record(bang: &Bang, order: usize) -> Option<ViewRecord> {
    let fields = fields(&SearchBang {
        trigger: bang.trigger.clone(),
        name: bang.name.clone(),
        url: bang.url.clone(),
        order: order as f64,
    })?;
    misty_browser_sync::document::entities::validate(Kind::SearchBang, &fields).ok()?;
    Some(ViewRecord {
        kind: Kind::SearchBang,
        id: format!("bang:{}", bang.trigger),
        fields,
    })
}

fn default_record(engine: &str) -> Option<ViewRecord> {
    Some(ViewRecord {
        kind: Kind::SearchDefault,
        id: DEFAULT_ID.into(),
        fields: fields(&SearchDefault {
            engine: engine.to_owned(),
        })?,
    })
}

fn read(records: &[ViewRecord], space_id: Option<String>) -> SpaceSearch {
    let mut engine = DEFAULT_ENGINE.to_owned();
    let mut engines: Vec<(f64, CustomEngine)> = Vec::new();
    let mut bangs: Vec<(f64, Bang)> = Vec::new();
    for record in records {
        match record.kind {
            Kind::SearchDefault => {
                if let Some(default) = parse::<SearchDefault>(record) {
                    engine = default.engine;
                }
            }
            Kind::SearchEngine => {
                if let Some(custom) = parse::<SearchEngine>(record) {
                    engines.push((
                        custom.order,
                        CustomEngine {
                            id: record.id.clone(),
                            name: custom.name,
                            search: custom.search,
                        },
                    ));
                }
            }
            Kind::SearchBang => {
                if let Some(bang) = parse::<SearchBang>(record) {
                    bangs.push((
                        bang.order,
                        Bang {
                            trigger: bang.trigger,
                            name: bang.name,
                            url: bang.url,
                        },
                    ));
                }
            }
            _ => {}
        }
    }
    engines.sort_by(|a, b| a.0.total_cmp(&b.0));
    bangs.sort_by(|a, b| {
        a.0.total_cmp(&b.0)
            .then_with(|| a.1.trigger.cmp(&b.1.trigger))
    });
    SpaceSearch {
        space_id,
        engine,
        engines: engines.into_iter().map(|(_, engine)| engine).collect(),
        bangs: bangs.into_iter().map(|(_, bang)| bang).collect(),
    }
}

/// The writes that turn the Space's bangs into `next`, in its order.
fn bang_writes(records: &[ViewRecord], next: &[Bang]) -> Vec<(String, Option<ViewRecord>)> {
    let mut writes: Vec<(String, Option<ViewRecord>)> = next
        .iter()
        .enumerate()
        .filter_map(|(order, bang)| {
            let record = bang_record(bang, order)?;
            let same = records
                .iter()
                .any(|current| current.id == record.id && current.fields == record.fields);
            (!same).then(|| (record.id.clone(), Some(record)))
        })
        .collect();
    writes.extend(
        records
            .iter()
            .filter(|record| record.kind == Kind::SearchBang)
            .filter(|record| {
                !next
                    .iter()
                    .any(|bang| format!("bang:{}", bang.trigger) == record.id)
            })
            .map(|record| (record.id.clone(), None)),
    );
    writes
}

/// The Space's search settings; None when its vault is not open (sync off or
/// locked), and the device's own values apply.
pub(super) async fn read_space(window_label: &str) -> Result<Option<SpaceSearch>, String> {
    let Some(vault) = space_vault(window_space(window_label).as_deref()).await else {
        return Ok(None);
    };
    let (_, records) = vault
        .handle
        .records_list(SEARCH.into())
        .await
        .map_err(|_| NO_SPACE.to_owned())?;
    Ok(Some(read(&records, vault.space_id)))
}

/// Replaces the Space's custom bangs.
pub(super) async fn set_bangs(window_label: &str, bangs: Vec<Bang>) -> Result<(), String> {
    if bangs.len() > 500 || bangs.iter().any(|bang| bang_record(bang, 0).is_none()) {
        return Err("Check the shortcut's name and search address.".into());
    }
    let vault = space_vault(window_space(window_label).as_deref())
        .await
        .ok_or(NO_SPACE)?;
    let (_, records) = vault
        .handle
        .records_list(SEARCH.into())
        .await
        .map_err(|_| NO_SPACE.to_owned())?;
    let writes = bang_writes(&records, &bangs);
    if writes.is_empty() {
        return Ok(());
    }
    vault
        .handle
        .records_write(SEARCH.into(), writes)
        .await
        .map_err(|_| "The shortcut could not be saved. Try again.".to_owned())
}

/// This device's default engine and bangs, for the personal Space's first seed.
pub(crate) fn seed_records(connection: &rusqlite::Connection) -> Vec<ViewRecord> {
    let document: Option<Value> = connection
        .query_row(
            "SELECT document FROM settings_document WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());
    let bangs: Vec<Bang> = document
        .as_ref()
        .and_then(|document| document.pointer("/general/browser_custom_bangs_json"))
        .and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    default_record(DEFAULT_ENGINE)
        .into_iter()
        .chain(
            bangs
                .iter()
                .enumerate()
                .filter_map(|(order, bang)| bang_record(bang, order)),
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bang(trigger: &str) -> Bang {
        Bang {
            trigger: trigger.into(),
            name: trigger.to_uppercase(),
            url: format!("https://{trigger}.example/search?q=%s"),
        }
    }

    #[test]
    fn bangs_round_trip_in_order_and_removed_ones_are_deleted() {
        let records: Vec<ViewRecord> = [bang("jira"), bang("wiki")]
            .iter()
            .enumerate()
            .filter_map(|(order, bang)| bang_record(bang, order))
            .chain(default_record("google"))
            .collect();
        let search = read(&records, None);
        assert_eq!(search.engine, "google");
        assert_eq!(search.bangs, [bang("jira"), bang("wiki")]);
        // Keep wiki first, drop jira, add docs: wiki and docs write, jira deletes.
        let writes = bang_writes(&records, &[bang("wiki"), bang("docs")]);
        let ids: Vec<_> = writes
            .iter()
            .map(|(id, w)| (id.as_str(), w.is_some()))
            .collect();
        assert_eq!(
            ids,
            [
                ("bang:wiki", true),
                ("bang:docs", true),
                ("bang:jira", false)
            ]
        );
        assert!(bang_writes(&records, &[bang("jira"), bang("wiki")]).is_empty());
        assert!(bang_record(
            &Bang {
                url: "https://x.example/".into(),
                ..bang("x")
            },
            0
        )
        .is_none());
    }
}
