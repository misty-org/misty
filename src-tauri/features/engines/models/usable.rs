//! The model an engine actually runs when a chat names none. Codex, Pi and Oh My Pi each keep a
//! default model in their own config, which can name a model the person's account doesn't offer
//! (a ChatGPT plan without that model): every turn then fails with "model not supported". The
//! engine's own model list says what the account can run, so:
//!
//! - the picker lists only those models, never the config's when it isn't among them, and marks
//!   as the engine's pick the config's model when listed, else the first the engine lists;
//! - a run that names no model is handed that first listed model explicitly, so the CLI doesn't
//!   fall back to its config's.
//!
//! The engine's config is never written: it stays as the person left it.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use super::{EngineCatalog, ModelDetails};

/// How long a listed set stands in for a fresh probe at send time.
const LISTED_FRESH: Duration = Duration::from_secs(10 * 60);

/// The model ids each engine last listed, in its order, kept by its catalog.
static LISTED: LazyLock<Mutex<HashMap<String, (Vec<String>, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The default model the engine's own config names, as the id its picker uses.
pub(super) fn configured_default(engine: &str) -> Option<String> {
    let text = |value: Option<&serde_json::Value>| {
        value
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    match engine {
        "codex" => {
            let home = crate::engines::codex_home();
            let content = std::fs::read_to_string(home.join("config.toml")).ok()?;
            let config: toml::Value = toml::from_str(&content).ok()?;
            // A provider of the person's own (`model_provider`) runs models Codex's account
            // list doesn't know; its model is theirs to choose.
            if config.get("model_provider").is_some() {
                return None;
            }
            config
                .get("model")?
                .as_str()
                .map(str::trim)
                .filter(|model| !model.is_empty())
                .map(str::to_string)
        }
        // `modelRoles.default: provider/model` in `config.yml`.
        "omp" => {
            let dir = crate::engines::pi_family_auth::agent_dir("omp").ok()?;
            let content = std::fs::read_to_string(dir.join("config.yml")).ok()?;
            let value: serde_json::Value = serde_yaml::from_str(&content).ok()?;
            text(value.pointer("/modelRoles/default"))
        }
        // `defaultProvider` and `defaultModel` in `settings.json`.
        "pi" => {
            let dir = crate::engines::pi_family_auth::agent_dir("pi").ok()?;
            let content = std::fs::read_to_string(dir.join("settings.json")).ok()?;
            let value: serde_json::Value = serde_json::from_str(&content).ok()?;
            let model = text(value.get("defaultModel"))?;
            if model.contains('/') {
                return Some(model);
            }
            Some(format!("{}/{model}", text(value.get("defaultProvider"))?))
        }
        _ => None,
    }
}

/// The model to run when the chat names none: the first the engine lists, but only when its
/// config's default isn't among them. None leaves the choice to the engine, as before.
pub(super) fn fallback(configured: Option<&str>, listed: &[String]) -> Option<String> {
    let configured = configured?;
    if listed.iter().any(|id| id == configured) {
        return None;
    }
    listed.first().cloned()
}

/// Shapes a catalog the engine listed: drops the config's default when the engine didn't list
/// it, leads with and marks the engine's pick, and keeps the list for [`model_for_run`].
pub(super) fn settle(engine: &str, mut catalog: EngineCatalog) -> EngineCatalog {
    let configured = configured_default(engine);
    let listed: Vec<String> = catalog
        .models
        .iter()
        .map(|model| model.id.clone())
        .collect();
    if listed.is_empty() {
        return catalog;
    }
    if let Ok(mut held) = LISTED.lock() {
        held.insert(engine.to_string(), (listed.clone(), Instant::now()));
    }
    let Some(configured) = configured else {
        return catalog;
    };
    let pick = if listed.contains(&configured) {
        configured
    } else {
        listed[0].clone()
    };
    if let Some(index) = catalog.models.iter().position(|model| model.id == pick) {
        catalog.models[..=index].rotate_right(1);
    }
    catalog
        .details
        .entry(pick)
        .or_insert_with(ModelDetails::default)
        .current = true;
    catalog
}

/// The model a run that names none is given (see [`fallback`]), from the engine's list as its
/// catalog last read it, or a fresh read when that is old or missing.
pub(crate) async fn model_for_run(engine: &str) -> Option<String> {
    if !matches!(engine, "codex" | "omp" | "pi") {
        return None;
    }
    let configured = configured_default(engine)?;
    let held = LISTED
        .lock()
        .ok()
        .and_then(|held| held.get(engine).cloned())
        .filter(|(_, at)| at.elapsed() < LISTED_FRESH)
        .map(|(listed, _)| listed);
    let listed = match held {
        Some(listed) => listed,
        None => super::list_engine_models(engine.to_string())
            .await
            .ok()?
            .models
            .into_iter()
            .map(|model| model.id)
            .collect(),
    };
    fallback(Some(&configured), &listed)
}

#[cfg(test)]
mod tests {
    use super::fallback;

    #[test]
    fn a_configured_model_the_engine_doesnt_list_gives_way_to_its_first() {
        let listed = ["gpt-6-luna".to_string(), "gpt-5.6-terra".to_string()];
        assert_eq!(
            fallback(Some("gpt-6.1-sol"), &listed).as_deref(),
            Some("gpt-6-luna")
        );
        // A listed one is the engine's to run, so the run passes nothing.
        assert_eq!(fallback(Some("gpt-5.6-terra"), &listed), None);
        // No config default, or nothing listed: the engine decides, as before.
        assert_eq!(fallback(None, &listed), None);
        assert_eq!(fallback(Some("gpt-6.1-sol"), &[]), None);
    }
}
