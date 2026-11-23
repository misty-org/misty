#[cfg(test)]
mod boundary {
    use browser_data::document::entities;
    use serde_json::Value;

    const RECORDS: &str = include_str!("testdata/renderer_records.json");

    fn collection(name: &str) -> Vec<Value> {
        let all: Value = serde_json::from_str(RECORDS).unwrap();
        all[name].as_array().unwrap().clone()
    }

    #[test]
    fn what_a_tab_publishes_is_accepted() {
        for tab in collection("tabs") {
            let tab: crate::browser::profiles::TabRecord = serde_json::from_value(tab).unwrap();
            let kind = entities::Kind::OpenTab;
            entities::validate(kind, &tab.fields).unwrap();
            assert!(tab.fields.contains_key("tree"));
        }
    }
}
