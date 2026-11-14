// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/claude.rs.
use super::catalog::{older, parse_account_catalog};
use super::*;
use crate::known_names::MAIN_MODEL_SECTION;

#[test]
fn aliases_cover_the_cli_model_menu() {
    let ids: Vec<&str> = CLI_ALIASES.iter().map(|(id, _)| *id).collect();
    assert_eq!(ids, vec!["default", "opus", "fable", "sonnet", "haiku"]);
}

#[test]
fn cli_config_local_overrides_user_per_field() {
    let dir = std::env::temp_dir().join(format!("ccgui-claude-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("settings.json"),
        r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"sonnet","ANTHROPIC_DEFAULT_OPUS_MODEL":"grok-4.5"}}"#,
    )
    .unwrap();
    std::fs::write(dir.join("settings.local.json"), r#"{"model":"haiku"}"#).unwrap();
    let config = read_cli_config_from(&dir);
    std::fs::remove_dir_all(&dir).ok();
    // Local `model` wins its field; the user file's env fields survive.
    assert_eq!(config.model_key.as_deref(), Some("haiku"));
    assert_eq!(config.env_model.as_deref(), Some("sonnet"));
    assert_eq!(config.override_for("opus"), Some("grok-4.5"));
    assert_eq!(config.override_for("sonnet"), None);
}

#[test]
fn launch_model_resolves_overrides_and_passes_the_rest_through() {
    let dir = std::env::temp_dir().join(format!("ccgui-claude-test4-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("settings.json"),
        r#"{"model":"opus","env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"gemini-3.8-flash"}}"#,
    )
    .unwrap();
    let config = read_cli_config_from(&dir);
    std::fs::remove_dir_all(&dir).ok();
    // Overridden alias → custom id (what the picker names it).
    assert_eq!(
        resolve_launch_model_from(&config, "opus"),
        "gemini-3.8-flash"
    );
    // `<family>[1m]` with an override: the person chose the 1M variant, so the suffix must
    // follow onto the mapped value. This used to return the override without it: the channel
    // side (claude_channel) kept the suffix, the official config dropped it, and a 1M
    // request silently fell back to the normal window.
    assert_eq!(
        resolve_launch_model_from(&config, "opus[1m]"),
        "gemini-3.8-flash[1m]"
    );
    // "default" → the CLI's configured default, override applied.
    assert_eq!(
        resolve_launch_model_from(&config, "default"),
        "gemini-3.8-flash"
    );
    // Unmapped aliases and raw ids pass through for the CLI to resolve.
    assert_eq!(resolve_launch_model_from(&config, "sonnet"), "sonnet");
    assert_eq!(
        resolve_launch_model_from(&config, "claude-opus-5"),
        "claude-opus-5"
    );
    // Nothing configured: "default" stays an alias for the CLI's `best`.
    assert_eq!(
        resolve_launch_model_from(&CliModelConfig::default(), "default"),
        "default"
    );
}

#[test]
fn cli_config_reads_env_when_no_local_file() {
    let dir = std::env::temp_dir().join(format!("ccgui-claude-test2-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("settings.json"),
        r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"k3"}}"#,
    )
    .unwrap();
    let config = read_cli_config_from(&dir);
    std::fs::remove_dir_all(&dir).ok();
    // env.ANTHROPIC_MODEL outranks the `model` key within one file.
    assert_eq!(config.resolved_default().as_deref(), Some("k3"));
}

#[test]
fn catalog_labels_overridden_aliases_like_the_cli_menu() {
    let dir = std::env::temp_dir().join(format!("ccgui-claude-test3-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("settings.json"),
        r#"{"model":"opus","env":{
            "ANTHROPIC_MODEL":"grok-4.5",
            "ANTHROPIC_DEFAULT_OPUS_MODEL":"grok-4.5",
            "ANTHROPIC_DEFAULT_SONNET_MODEL":"grok-4.5",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL":"grok-4.5",
            "ANTHROPIC_DEFAULT_FABLE_MODEL":"grok-4.5"
        }}"#,
    )
    .unwrap();
    let config = read_cli_config_from(&dir);
    std::fs::remove_dir_all(&dir).ok();
    // The /model menu's main label is the resolved custom id, with the
    // "Custom <Family> model" subtitle the CLI shows.
    let models = claude_models_from(config, None);
    let by_id = |id: &str| models.iter().find(|m| m.id == id).unwrap();
    let opus = by_id("opus");
    assert_eq!(opus.name.as_deref(), Some("grok-4.5"));
    assert_eq!(opus.description.as_deref(), Some("Custom Opus model"));
    assert_eq!(
        by_id("fable").description.as_deref(),
        Some("Custom Fable model")
    );
    let default = by_id("default");
    assert_eq!(default.name.as_deref(), Some("Default"));
    assert_eq!(
        default.description.as_deref(),
        Some("Use the default model (currently grok-4.5)")
    );
    // Exactly the CLI menu's five rows, "default" first — no extra
    // "configured" row, no [1m] variants.
    assert_eq!(models.len(), 5);
    assert_eq!(models[0].id, "default");
}

#[test]
fn resolved_default_maps_alias_through_override() {
    let config = CliModelConfig {
        provider_flags: Default::default(),
        env_model: None,
        model_key: Some("opus[1m]".to_string()),
        overrides: [("opus".to_string(), "grok-4.5".to_string())]
            .into_iter()
            .collect(),
    };
    // A default model written as `<family>[1m]` with an override: the suffix follows onto
    // the mapped value, the same convention as resolve_launch_model_from's selector path.
    assert_eq!(config.resolved_default().as_deref(), Some("grok-4.5[1m]"));
    // An override that already carries `[1m]` doesn't get the suffix twice.
    let config = CliModelConfig {
        provider_flags: Default::default(),
        env_model: None,
        model_key: Some("opus[1m]".to_string()),
        overrides: [("opus".to_string(), "grok-4.5[1m]".to_string())]
            .into_iter()
            .collect(),
    };
    assert_eq!(config.resolved_default().as_deref(), Some("grok-4.5[1m]"));
    // A raw id passes through untouched.
    let config = CliModelConfig {
        env_model: Some("k3".to_string()),
        ..CliModelConfig::default()
    };
    assert_eq!(config.resolved_default().as_deref(), Some("k3"));
}

/// A registry snippet shaped exactly like the CLI binary's embedded
/// object: models array, then aliases/defaults/best.
fn fake_registry() -> EmbeddedRegistry {
    parse_registry(
        br#"[{id:"claude-opus-4-5",family:"opus",display_name:"Opus 4.5"},{id:"claude-opus-5",family:"opus",display_name:"Opus 5"},{id:"claude-fable-5",family:"fable",display_name:"Fable 5"}],aliases:{opus:{default:"claude-opus-5",per_provider:{bedrock:"claude-opus-5",gateway:"claude-opus-4-7"}},fable:{default:"claude-fable-5"}},defaults:{},best:"fable",latest_per_family:{opus:"claude-opus-5"}});"#,
    )
}

#[test]
fn comparison_resolves_aliases_overrides_and_provider_variants() {
    let registry = fake_registry();
    let mut config = CliModelConfig::default();
    assert_eq!(
        comparison_model_from("opus", &config, Some(&registry)).as_deref(),
        Some("claude-opus-5")
    );
    assert_eq!(
        comparison_model_from("opus[1m]", &config, Some(&registry)).as_deref(),
        Some("claude-opus-5")
    );
    assert_eq!(
        comparison_model_from("default", &config, Some(&registry)).as_deref(),
        Some("claude-fable-5")
    );
    merge_settings_json(&mut config, r#"{"env":{"CLAUDE_CODE_USE_BEDROCK":"1"}}"#);
    assert_eq!(
        comparison_model_from("opus", &config, Some(&registry)).as_deref(),
        Some("claude-opus-5")
    );
    merge_settings_json(
        &mut config,
        r#"{"env":{"CLAUDE_CODE_USE_BEDROCK":"0","CLAUDE_CODE_USE_VERTEX":"1"}}"#,
    );
    assert_eq!(
        comparison_model_from("opus", &config, Some(&registry)),
        None
    );
    merge_settings_json(
        &mut config,
        r#"{"model":"opus","env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"custom-opus"}}"#,
    );
    assert_eq!(
        comparison_model_from("opus", &config, Some(&registry)).as_deref(),
        Some("custom-opus")
    );
    // The 1M variant's comparison value is also the concrete model name: bareModel strips
    // `[1m]` before comparing, the badge's left side already shows the chosen `opus[1m]`,
    // and the right side should give the actual model.
    assert_eq!(
        comparison_model_from("opus[1m]", &config, Some(&registry)).as_deref(),
        Some("custom-opus")
    );
    assert_eq!(
        comparison_model_from("default", &config, None).as_deref(),
        Some("custom-opus")
    );
}

#[test]
fn comparison_does_not_guess_aliases_without_a_registry() {
    let config = CliModelConfig::default();
    for selector in ["opus", "sonnet", "haiku", "fable", "default"] {
        assert_eq!(comparison_model_from(selector, &config, None), None);
    }
    assert_eq!(
        comparison_model_from("claude-opus-5-5", &config, None).as_deref(),
        Some("claude-opus-5-5")
    );
}

#[test]
fn parse_registry_extracts_aliases_displays_and_best() {
    let registry = fake_registry();
    assert_eq!(
        registry.alias_defaults.get("opus").map(String::as_str),
        Some("claude-opus-5")
    );
    assert_eq!(
        registry.alias_defaults.get("fable").map(String::as_str),
        Some("claude-fable-5")
    );
    assert_eq!(
        registry
            .display_names
            .get("claude-opus-5")
            .map(String::as_str),
        Some("Opus 5")
    );
    assert_eq!(registry.best.as_deref(), Some("fable"));
    // Noise without the registry's shape contributes nothing.
    assert!(
        parse_registry(br#"aliases:Qn(N(),cyg()),foo:{default:32000}"#)
            .alias_defaults
            .is_empty()
    );
}

#[test]
fn display_line_resolves_aliases_suffixes_and_unknowns() {
    let registry = fake_registry();
    assert_eq!(registry.display_line("opus"), "Opus 5 · claude-opus-5");
    assert_eq!(registry.display_line("opus[1m]"), "Opus 5 · claude-opus-5");
    // A raw id resolves to its display name; an unknown selector passes
    // through verbatim.
    assert_eq!(
        registry.display_line("claude-fable-5"),
        "Fable 5 · claude-fable-5"
    );
    assert_eq!(registry.display_line("k3"), "k3");
}

#[test]
fn catalog_names_the_concrete_model_each_alias_runs() {
    let registry = fake_registry();
    let config = CliModelConfig {
        model_key: Some("opus".to_string()),
        ..CliModelConfig::default()
    };
    let models = claude_models_from(config, Some(&registry));
    let by_id = |id: &str| models.iter().find(|m| m.id == id).unwrap();
    assert_eq!(
        by_id("opus").description.as_deref(),
        Some("Opus 5 · claude-opus-5")
    );
    assert_eq!(
        by_id("default").description.as_deref(),
        Some("Use the default model (currently Opus 5 · claude-opus-5)")
    );
    // No registry entry (sonnet/haiku absent from the fake) → no
    // description, same as a CLI too old to embed one.
    assert_eq!(by_id("sonnet").description, None);
}

#[test]
fn catalog_falls_back_to_registry_best_when_unconfigured() {
    let registry = fake_registry();
    let models = claude_models_from(CliModelConfig::default(), Some(&registry));
    let default = models.iter().find(|m| m.id == "default").unwrap();
    assert_eq!(
        default.description.as_deref(),
        Some("Use the default model (currently Fable 5 · claude-fable-5)")
    );
    // Without a registry an unconfigured default stays silent.
    let models = claude_models_from(CliModelConfig::default(), None);
    assert_eq!(models[0].description, None);
}

#[test]
fn details_name_each_alias_with_its_efforts() {
    let registry = parse_registry(
        br#"[{id:"claude-opus-5",family:"opus",display_name:"Opus 5",context:{window:1e6,native_1m:!0},capabilities:["effort","xhigh_effort","max_effort"],default_effort:"high"},{id:"claude-haiku-4",family:"haiku",display_name:"Haiku 4",capabilities:["vision"]}],aliases:{opus:{default:"claude-opus-5"},haiku:{default:"claude-haiku-4"}},defaults:{},best:"opus"});"#,
    );
    let details = claude_model_details_from(&CliModelConfig::default(), &registry);
    let opus = &details["opus"];
    assert_eq!(opus.name.as_deref(), Some("Opus 5"));
    assert_eq!(opus.detail.as_deref(), Some("claude-opus-5"));
    let levels: Vec<&str> = opus
        .efforts
        .iter()
        .flatten()
        .map(|level| level.id.as_str())
        .collect();
    assert_eq!(levels, ["low", "medium", "high", "xhigh", "max"]);
    assert_eq!(opus.default_effort.as_deref(), Some("high"));
    assert_eq!(opus.context_window, Some(1_000_000));
    // A model whose capabilities don't include effort takes no levels.
    assert_eq!(details["haiku"].efforts.as_ref().map(Vec::len), Some(0));
    // Nothing configured: "default" is the registry's best, and is the CLI's own pick.
    assert_eq!(details["default"].name.as_deref(), Some("Opus 5"));
    assert!(details["default"].current);
    // Not in the registry, so it isn't described.
    assert!(!details.contains_key("sonnet"));
}

#[test]
fn account_catalog_is_the_cli_own_menu() {
    let value = serde_json::json!({"catalog":{"config":{"models":[
      {"id":"claude-opus-5-5","name":"Opus 5.5","description":"For complex work","section":MAIN_MODEL_SECTION,
       "thinking":{"type":"effort","effort_options":[{"id":"medium","name":"Medium","badge":{"message":"Recommended"}},{"id":"xhigh","name":"Extra"}]},
       "fast_mode":{"type":"toggle","name":"Fast mode","options":[{"id":"fast","name":"Enable fast mode"},{"id":"off","name":"Off"}]},
       "runtime":{"max_input_tokens":1000000,"default_effort":"medium"}},
      {"id":"claude-haiku-4-5","name":"Haiku 4.5","section":"overflow","thinking":{"type":"none"},
       "runtime":{"max_input_tokens":200000}},
      {"id":"claude-next","name":"Next","section":MAIN_MODEL_SECTION,"min_claude_code_version":"9.0.0"}
    ]},"state":{"model":"claude-opus-5-5",
      "thinking_by_model":[{"id":"claude-opus-5-5","thinking":{"type":"effort","effort":"xhigh"}}]}}});
    let (models, details) = parse_account_catalog(&value, Some("2.1.322"));
    // Too new for this CLI: left out, as the CLI's own menu does.
    assert_eq!(
        models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        ["claude-opus-5-5", "claude-haiku-4-5"]
    );
    let opus = &details["claude-opus-5-5"];
    assert_eq!(opus.section.as_deref(), Some(MAIN_MODEL_SECTION));
    assert!(opus.current);
    let fast = opus.fast.as_ref().unwrap();
    assert_eq!(
        (fast.label.as_str(), fast.tier.as_str()),
        ("Fast mode", "fast")
    );
    // The level the CLI last used with it wins over its default.
    assert_eq!(opus.default_effort.as_deref(), Some("xhigh"));
    let levels = opus.efforts.as_ref().unwrap();
    assert_eq!(levels[1].name.as_deref(), Some("Extra"));
    assert_eq!(levels[0].badge.as_deref(), Some("Recommended"));
    let haiku = &details["claude-haiku-4-5"];
    assert_eq!(haiku.section.as_deref(), Some("more"));
    assert_eq!(haiku.efforts.as_ref().map(Vec::len), Some(0));
    assert!(haiku.fast.is_none() && !haiku.current);
}

#[test]
fn version_order_reads_each_number() {
    assert!(older("2.1.251", "2.1.280"));
    assert!(!older("2.1.322", "2.1.290"));
    assert!(older("2.9.0", "2.10.0"));
}
