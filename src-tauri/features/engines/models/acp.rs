// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/mod.rs.
//! What an ACP engine says about itself in its `session/new` result: its reasoning levels and modes.

use super::EffortLevel;

/// An ACP engine's own reasoning levels, from its `session/new` result: the config option of
/// category `thought_level` (or id `reasoning_effort`), its options as levels with the engine's
/// names and lines, and its current value. None when the engine offers no such option.
pub(crate) fn acp_thought_levels(
    session: &serde_json::Value,
) -> Option<(Vec<EffortLevel>, Option<String>)> {
    let text = |value: Option<&serde_json::Value>| {
        value
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    let option = session
        .get("configOptions")
        .and_then(serde_json::Value::as_array)?
        .iter()
        .find(|option| {
            text(option.get("category")).as_deref() == Some("thought_level")
                || text(option.get("id")).as_deref() == Some("reasoning_effort")
        })?;
    let levels: Vec<EffortLevel> = option
        .get("options")
        .and_then(serde_json::Value::as_array)?
        .iter()
        .filter_map(|choice| {
            let id = text(choice.get("value")).or_else(|| text(choice.get("id")))?;
            Some(EffortLevel {
                name: text(choice.get("name")).filter(|name| *name != id),
                description: text(choice.get("description")),
                id,
                ..EffortLevel::default()
            })
        })
        .collect();
    (!levels.is_empty()).then(|| (levels, text(option.get("currentValue"))))
}

/// An ACP engine's own modes, with its names for them, from its `session/new` result
/// (`modes.availableModes`).
pub(crate) fn acp_modes(session: &serde_json::Value) -> Vec<super::super::modes::ListedMode> {
    session
        .pointer("/modes/availableModes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|mode| {
            let id = mode.get("id")?.as_str()?.trim().to_string();
            (!id.is_empty()).then(|| super::super::modes::ListedMode {
                name: mode
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string),
                id,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_acp_engine_own_levels_and_modes() {
        // Oh My Pi's live `session/new` shape.
        let session = serde_json::json!({
            "configOptions": [
                {"id": "model", "category": "model", "options": []},
                {"id": "thinking", "category": "thought_level", "currentValue": "high", "options": [
                    {"value": "off", "name": "Off"},
                    {"value": "auto", "name": "Auto", "description": "Auto-detect per prompt"},
                    {"value": "high", "name": "high"}
                ]}
            ],
            "modes": {"currentModeId": "default", "availableModes": [
                {"id": "default", "name": "Default"},
                {"id": "plan", "name": "Plan", "description": "Read-only planning mode"}
            ]}
        });
        let (levels, current) = acp_thought_levels(&session).unwrap();
        assert_eq!(
            levels
                .iter()
                .map(|level| level.id.as_str())
                .collect::<Vec<_>>(),
            ["off", "auto", "high"]
        );
        assert_eq!(
            levels[1].description.as_deref(),
            Some("Auto-detect per prompt")
        );
        // A name that only repeats the id says nothing more.
        assert_eq!(levels[2].name, None);
        assert_eq!(current.as_deref(), Some("high"));
        let modes = acp_modes(&session);
        assert_eq!(modes[1].id, "plan");
        assert_eq!(modes[1].name.as_deref(), Some("Plan"));
        assert!(acp_thought_levels(&serde_json::json!({})).is_none());
    }
}
