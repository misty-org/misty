use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use super::EngineCatalog;

const LISTED_FRESH: Duration = Duration::from_secs(10 * 60);

type Listed = HashMap<String, (Vec<String>, Instant)>;

static LISTED: LazyLock<Mutex<Listed>> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[allow(
    clippy::disallowed_methods,
    reason = "reads each engine's own config in place, under homes the person or an env override may move outside the engine folders the gate grants"
)]
pub(super) fn configured_default(engine: &str) -> Option<String> {
    match engine {
        "codex" => {
            let home = crate::engines::codex_home();
            let content = std::fs::read_to_string(home.join("config.toml")).ok()?;
            let config: toml::Value = toml::from_str(&content).ok()?;
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
        _ => None,
    }
}

pub(super) fn fallback(configured: Option<&str>, listed: &[String]) -> Option<String> {
    let configured = configured?;
    if listed.iter().any(|id| id == configured) {
        return None;
    }
    listed.first().cloned()
}

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
    catalog.details.entry(pick).or_default().current = true;
    catalog
}

pub(crate) async fn model_for_run(engine: &str) -> Option<String> {
    if engine != "codex" {
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
        assert_eq!(fallback(Some("gpt-5.6-terra"), &listed), None);
        assert_eq!(fallback(None, &listed), None);
        assert_eq!(fallback(Some("gpt-6.1-sol"), &[]), None);
    }
}
