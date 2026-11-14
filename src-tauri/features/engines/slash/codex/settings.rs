//! Codex's settings: `/personality`, `/experimental`, `/memories` and `/debug-config`.

use super::*;

pub(super) async fn personality(context: &Context) -> Result<Output, String> {
    let wanted = context.args.trim().to_ascii_lowercase();
    if wanted.is_empty() {
        let config = call_once(context, "config/read", json!({ "cwd": folder(context) })).await?;
        let current =
            shown(&config["config"]["personality"]).unwrap_or_else(|| "Codex default".into());
        return Ok(Output::info(
            "Personality",
            vec![Section {
                rows: vec![row("Now", current), row("Styles", PERSONALITIES.join(", "))],
                text: Some("Choose one with /personality <style>.".into()),
                ..Default::default()
            }],
        ));
    }
    if !PERSONALITIES.contains(&wanted.as_str()) {
        return Err(format!("Codex's styles are {}.", PERSONALITIES.join(", ")));
    }
    // The terminal app saves the choice as the default in config.toml; so does this.
    call_once(
        context,
        "config/value/write",
        json!({ "keyPath": "personality", "value": wanted.as_str(), "mergeStrategy": "replace" }),
    )
    .await?;
    Ok(Output::done(format!(
        "Codex will answer in the {wanted} style from the next message."
    )))
}

/// Experimental features, saved in config.toml's `[features]` as the terminal app saves them:
/// `experimentalFeature/enablement/set` only lasts as long as the app-server, and this one stops
/// right after.
pub(super) async fn experimental(context: &Context) -> Result<Output, String> {
    let args = context.args.trim();
    let mut rpc = open(context).await?;
    let result = experimental_in(&mut rpc, args).await;
    rpc.stop().await;
    result
}

async fn experimental_in(rpc: &mut Session, args: &str) -> Result<Output, String> {
    let features = all_pages(rpc, "experimentalFeature/list", json!({ "limit": 200 })).await?;
    let (name, rest) = split_first(args);
    if name.is_empty() {
        let rows: Vec<Row> = features
            .iter()
            .filter(|feature| feature["stage"].as_str() == Some("beta"))
            .map(|feature| {
                let label = text_at(feature, "/displayName")
                    .or_else(|| text_at(feature, "/name"))
                    .unwrap_or("feature");
                let state = if feature["enabled"].as_bool() == Some(true) {
                    "on"
                } else {
                    "off"
                };
                let value = match (text_at(feature, "/name"), text_at(feature, "/description")) {
                    (Some(id), Some(about)) => format!("{state} · {id} · {}", short(about, 100)),
                    (Some(id), None) => format!("{state} · {id}"),
                    _ => state.to_string(),
                };
                row(label, value)
            })
            .collect();
        if rows.is_empty() {
            return Ok(Output::done("Codex has no experimental features to try."));
        }
        return Ok(Output::info(
            "Experimental features",
            vec![Section {
                rows,
                text: Some("Turn one on or off with /experimental <feature> on|off.".into()),
                ..Default::default()
            }],
        ));
    }
    let on = match rest {
        "on" => true,
        "off" => false,
        _ => return Err("Use /experimental <feature> on or /experimental <feature> off.".into()),
    };
    // Only a feature Codex lists becomes a key in config.toml.
    let known = features.iter().any(|feature| {
        feature["name"].as_str() == Some(name) && feature["stage"].as_str() != Some("removed")
    });
    if !known {
        return Err(format!("Codex has no feature {name}. See /experimental."));
    }
    rpc.call(
        "config/value/write",
        json!({ "keyPath": format!("features.{name}"), "value": on, "mergeStrategy": "replace" }),
    )
    .await
    .map_err(text)?;
    Ok(Output::done(format!(
        "Turned {name} {}. Codex uses it from the next message.",
        if on { "on" } else { "off" }
    )))
}

/// Memories: the `memories` feature and `[memories]` use and generation in config.toml, plus
/// the chat's own thread when it has one.
pub(super) async fn memories(context: &Context) -> Result<Output, String> {
    let args = context.args.trim();
    let mut rpc = open(context).await?;
    let result = memories_in(&mut rpc, context, args).await;
    rpc.stop().await;
    result
}

async fn memories_in(rpc: &mut Session, context: &Context, args: &str) -> Result<Output, String> {
    match args {
        "" => {
            let config = rpc
                .call("config/read", json!({ "cwd": folder(context) }))
                .await
                .map_err(text)?;
            let config = &config["config"];
            let flag = |value: &Value, fallback: &str| match value.as_bool() {
                Some(true) => "on".to_string(),
                Some(false) => "off".to_string(),
                None => fallback.to_string(),
            };
            Ok(Output::info(
                "Memories",
                vec![Section {
                    rows: vec![
                        row(
                            "Memories feature",
                            flag(&config["features"]["memories"], "off"),
                        ),
                        row(
                            "Use memories",
                            flag(&config["memories"]["use_memories"], "Codex default"),
                        ),
                        row(
                            "Make new memories",
                            flag(&config["memories"]["generate_memories"], "Codex default"),
                        ),
                    ],
                    text: Some(
                        "Change them with /memories on, /memories off or /memories reset.".into(),
                    ),
                    ..Default::default()
                }],
            ))
        }
        "on" | "off" => {
            let on = args == "on";
            let mut edits = vec![
                json!({ "keyPath": "memories.use_memories", "value": on, "mergeStrategy": "replace" }),
                json!({ "keyPath": "memories.generate_memories", "value": on, "mergeStrategy": "replace" }),
            ];
            // Turning memories on needs the feature too; turning them off leaves the feature be.
            if on {
                edits.push(json!({ "keyPath": "features.memories", "value": true, "mergeStrategy": "replace" }));
            }
            rpc.call("config/batchWrite", json!({ "edits": edits }))
                .await
                .map_err(text)?;
            if let Some(thread) = context.session.as_deref() {
                let mode = if on { "enabled" } else { "disabled" };
                on_thread(
                    rpc,
                    thread,
                    "thread/memoryMode/set",
                    json!({ "threadId": thread, "mode": mode }),
                )
                .await?;
            }
            Ok(Output::done(if on {
                "Memories are on: Codex uses and makes them from the next message."
            } else {
                "Memories are off: Codex neither uses nor makes them from the next message."
            }))
        }
        "reset" => {
            rpc.call("memory/reset", Value::Null).await.map_err(text)?;
            Ok(Output::done("Reset Codex's local memories."))
        }
        _ => Err("Use /memories, /memories on, /memories off or /memories reset.".into()),
    }
}

pub(super) async fn debug_config(context: &Context) -> Result<Output, String> {
    let mut rpc = open(context).await?;
    let config = rpc
        .call(
            "config/read",
            json!({ "cwd": folder(context), "includeLayers": true }),
        )
        .await
        .map_err(text);
    let requirements = rpc
        .call("configRequirements/read", Value::Null)
        .await
        .map_err(text);
    rpc.stop().await;
    let config = config?;
    let mut sections = Vec::new();
    // Only where each layer comes from: a layer's own values can hold credentials.
    let layers: Vec<Row> = config["layers"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|layer| {
            let mut value = layer_source(&layer["name"]);
            if let Some(reason) = text_at(layer, "/disabledReason") {
                value.push_str(&format!(" · off: {reason}"));
            }
            row(
                layer_kind(layer["name"]["type"].as_str().unwrap_or_default()),
                value,
            )
        })
        .collect();
    sections.push(heading_rows("Layers, strongest first", layers));
    let origins = &config["origins"];
    let from: Vec<Row> = [
        "model",
        "model_provider",
        "model_reasoning_effort",
        "sandbox_mode",
        "approval_policy",
        "personality",
        "service_tier",
    ]
    .into_iter()
    .filter_map(|key| {
        let origin = origins.get(key)?;
        Some(row(key, layer_source(&origin["name"])))
    })
    .collect();
    if !from.is_empty() {
        sections.push(heading_rows("Where settings come from", from));
    }
    sections.push(match requirements {
        Ok(read) => match read["requirements"].as_object() {
            Some(set) => {
                let rows: Vec<Row> = set
                    .iter()
                    .filter(|(_, value)| !value.is_null())
                    .map(|(key, value)| row(key, shown(value).unwrap_or_default()))
                    .collect();
                heading_rows("Requirements", rows)
            }
            None => text_section("Requirements", "None: nothing here is managed.".into()),
        },
        Err(error) => text_section("Requirements", error),
    });
    Ok(Output::info("Codex config", sections))
}

/// A config layer's source as one line (`ConfigLayerSource`).
fn layer_source(name: &Value) -> String {
    let parts: Vec<String> = [
        "file",
        "dotCodexFolder",
        "profile",
        "domain",
        "key",
        "name",
        "id",
    ]
    .into_iter()
    .filter_map(|key| text_at(name, &format!("/{key}")).map(str::to_string))
    .collect();
    if !parts.is_empty() {
        return parts.join(" · ");
    }
    match name["type"].as_str().unwrap_or_default() {
        "sessionFlags" => "Codex's command line".into(),
        kind => layer_kind(kind),
    }
}

/// A config layer's kind (`ConfigLayerSource.type`) in words.
fn layer_kind(kind: &str) -> String {
    match kind {
        "user" => "User".into(),
        "project" => "Project".into(),
        "system" => "System".into(),
        "sessionFlags" => "Launch flags".into(),
        "mdm" => "Managed by MDM".into(),
        "enterpriseManaged" => "Managed by your organization".into(),
        "legacyManagedConfigTomlFromFile" => "Managed config file".into(),
        "legacyManagedConfigTomlFromMdm" => "Managed config by MDM".into(),
        "" => "Layer".into(),
        other => other.into(),
    }
}
