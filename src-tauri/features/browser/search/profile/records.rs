//! The `search` collection of a profile, as the first profile is seeded with it: the default
//! engine and this computer's custom `!bangs` from before they were the profile's. Nothing reads
//! the collection now: a person no longer searches the web from Misty.
use browser_data::document::{
    entities::{Kind, SearchBang, SearchDefault},
    ViewRecord,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The engine a profile searches with until someone picks another.
const DEFAULT_ENGINE: &str = "google";
const DEFAULT_ID: &str = "default";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Bang {
    pub trigger: String,
    pub name: String,
    pub url: String,
}

fn fields<T: Serialize>(value: &T) -> Option<browser_data::document::entities::Fields> {
    match serde_json::to_value(value) {
        Ok(Value::Object(fields)) => Some(fields.into_iter().collect()),
        _ => None,
    }
}

fn bang_record(bang: &Bang, order: usize) -> Option<ViewRecord> {
    let fields = fields(&SearchBang {
        trigger: bang.trigger.clone(),
        name: bang.name.clone(),
        url: bang.url.clone(),
        order: order as f64,
    })?;
    browser_data::document::entities::validate(Kind::SearchBang, &fields).ok()?;
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

/// This computer's default engine and bangs, for the first profile's seed.
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

    #[test]
    fn a_bang_without_a_query_slot_is_left_out_of_the_seed() {
        let bang = |url: &str| Bang {
            trigger: "wiki".into(),
            name: "Wiki".into(),
            url: url.into(),
        };
        assert!(bang_record(&bang("https://wiki.example/search?q=%s"), 0).is_some());
        assert!(bang_record(&bang("https://wiki.example/"), 0).is_none());
        assert_eq!(default_record("google").unwrap().id, DEFAULT_ID);
    }
}
