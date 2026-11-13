// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// Provider channels: a third-party API (GLM, Kimi, DeepSeek, OpenRouter and the like) an engine
// CLI is started against instead of its own sign-in. Each engine has its channels, the one in use
// (`current`), and the official config of the CLI itself.
//
// The channel list is this computer's data in `misty.db` and never syncs. A channel's key, and
// any other secret in it (a token in its environment, a Codex bearer token or header), is kept
// apart in the credential store, sealed under the master key in the OS keychain. Windows only
// ever see whether a channel has a key. The key goes only into the CLI's environment, which
// sends it to the channel's provider.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};

use super::support;

pub const LOCAL_PROVIDER_ID: &str = "__local_settings_json__";
/// The older spelling of the same "use the CLI's own config" choice, kept for imported data.
pub(crate) const LEGACY_LOCAL_CONFIG_TOML_ID: &str = "__local_config_toml__";
pub const DISABLED_PROVIDER_ID: &str = "__disabled__";

/// The engines a channel can be set for.
pub const ENGINES: [&str; 15] = [
    "claude",
    "codex",
    "opencode",
    "gemini",
    "qwen",
    "kimi",
    "grok",
    "minimax",
    "qoder",
    "qoder-cn",
    "omp",
    "codebuddy",
    "agy",
    "pi",
    "dsh",
];

const STORE_KEY: &str = "channels";

pub(crate) fn checked_engine(engine: &str) -> Result<String, String> {
    let trimmed = engine.trim();
    if ENGINES.contains(&trimmed) {
        Ok(trimmed.to_string())
    } else {
        Err(format!("Unknown engine: {engine}"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ProviderSection {
    #[serde(default)]
    pub providers: Map<String, Value>,
    /// The order channels are listed and tried in. `providers` is a sorted map, so the order is
    /// kept here.
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub current: Option<String>,
    /// The channel in use when the engine was turned off, brought back when it is turned on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_from: Option<String>,
}

impl ProviderSection {
    /// Channel ids in list order: `order` first, then any it doesn't name.
    pub fn ordered_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self
            .order
            .iter()
            .filter(|id| self.providers.contains_key(*id))
            .cloned()
            .collect();
        for id in self.providers.keys() {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
        ids
    }

    pub fn insert(&mut self, id: String, value: Value) {
        if !self.order.contains(&id) {
            self.order.push(id.clone());
        }
        self.providers.insert(id, value);
    }

    pub fn remove(&mut self, id: &str) -> Option<Value> {
        self.order.retain(|existing| existing != id);
        self.providers.remove(id)
    }
}

/// Every engine's channels, by engine id.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct CliConfig {
    #[serde(flatten)]
    pub sections: BTreeMap<String, ProviderSection>,
}

impl CliConfig {
    pub fn section(&self, engine: &str) -> Option<&ProviderSection> {
        static EMPTY: std::sync::LazyLock<ProviderSection> =
            std::sync::LazyLock::new(ProviderSection::default);
        if !ENGINES.contains(&engine) {
            return None;
        }
        Some(self.sections.get(engine).unwrap_or(&EMPTY))
    }

    pub fn section_mut(&mut self, engine: &str) -> Option<&mut ProviderSection> {
        if !ENGINES.contains(&engine) {
            return None;
        }
        Some(self.sections.entry(engine.to_string()).or_default())
    }
}

static CONFIG_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Held by every read-modify-write of the channel list.
pub(crate) fn lock() -> parking_lot::MutexGuard<'static, ()> {
    CONFIG_LOCK.lock()
}

pub fn read_config() -> Result<CliConfig, String> {
    Ok(support::load_value::<CliConfig>(STORE_KEY)?.unwrap_or_default())
}

fn write_config(config: &CliConfig) -> Result<(), String> {
    support::save_value(STORE_KEY, config)
}

// ── Secrets ─────────────────────────────────────────────────────────────────

/// A channel's secrets by JSON pointer into the channel (`/apiKey`,
/// `/settingsConfig/env/ANTHROPIC_AUTH_TOKEN`, …), as kept in the credential store.
type Secrets = BTreeMap<String, String>;

fn secret_account(engine: &str, id: &str) -> String {
    format!("{engine}/{id}")
}

/// Whether a field or variable named `key` holds a secret.
fn is_secret_name(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    ["KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL"]
        .iter()
        .any(|word| upper.contains(word))
        && !upper.ends_with("_FILE_DESCRIPTOR")
}

fn escape_pointer(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// Takes every secret out of `provider`, leaving the rest to be stored as device data.
fn split_secrets(provider: &mut Value) -> Secrets {
    let mut secrets = Secrets::new();
    let Some(root) = provider.as_object_mut() else {
        return secrets;
    };
    for key in ["apiKey", "authToken"] {
        if let Some(Value::String(value)) = root.remove(key) {
            if !value.trim().is_empty() {
                secrets.insert(format!("/{key}"), value);
            }
        }
    }
    let mut take_from = |map: &mut Map<String, Value>, prefix: &str, all: bool| {
        let names: Vec<String> = map
            .iter()
            .filter(|(name, value)| value.is_string() && (all || is_secret_name(name)))
            .map(|(name, _)| name.clone())
            .collect();
        for name in names {
            if let Some(Value::String(value)) = map.remove(&name) {
                if !value.trim().is_empty() {
                    secrets.insert(format!("{prefix}/{}", escape_pointer(&name)), value);
                }
            }
        }
    };
    if let Some(env) = root.get_mut("env").and_then(Value::as_object_mut) {
        take_from(env, "/env", false);
    }
    if let Some(settings) = root
        .get_mut("settingsConfig")
        .and_then(Value::as_object_mut)
    {
        if let Some(env) = settings.get_mut("env").and_then(Value::as_object_mut) {
            take_from(env, "/settingsConfig/env", false);
        }
        if let Some(auth) = settings.get_mut("auth").and_then(Value::as_object_mut) {
            take_from(auth, "/settingsConfig/auth", true);
        }
        // A Codex provider document can authenticate with a literal bearer token or headers:
        // the whole document is then kept as a secret.
        let secret_config = settings
            .get("config")
            .and_then(Value::as_str)
            .is_some_and(|text| {
                text.contains("experimental_bearer_token") || text.contains("http_headers")
            });
        if secret_config {
            if let Some(Value::String(text)) = settings.remove("config") {
                secrets.insert("/settingsConfig/config".into(), text);
            }
        }
    }
    secrets
}

/// Puts `secrets` back into `provider` at their pointers.
fn merge_secrets(provider: &mut Value, secrets: &Secrets) {
    for (pointer, value) in secrets {
        let segments: Vec<String> = pointer
            .split('/')
            .skip(1)
            .map(|segment| segment.replace("~1", "/").replace("~0", "~"))
            .collect();
        let Some((last, parents)) = segments.split_last() else {
            continue;
        };
        let mut node = &mut *provider;
        for segment in parents {
            if !node.is_object() {
                *node = Value::Object(Map::new());
            }
            node = node
                .as_object_mut()
                .expect("object above")
                .entry(segment.clone())
                .or_insert_with(|| Value::Object(Map::new()));
        }
        if let Some(map) = node.as_object_mut() {
            map.insert(last.clone(), Value::String(value.clone()));
        }
    }
}

#[cfg(not(test))]
mod secret_store {
    pub fn load(account: &str) -> Result<Option<String>, String> {
        super::support::load_secret(account)
    }
    pub fn store(account: &str, value: &str) -> Result<(), String> {
        super::support::store_secret(account, value)
    }
    pub fn delete(account: &str) -> Result<(), String> {
        super::support::delete_secret(account)
    }
}

/// Tests keep secrets in memory, apart from the credential store.
#[cfg(test)]
pub(crate) mod secret_store {
    use std::collections::HashMap;
    static SECRETS: parking_lot::Mutex<Option<HashMap<String, String>>> =
        parking_lot::Mutex::new(None);
    pub fn load(account: &str) -> Result<Option<String>, String> {
        Ok(SECRETS
            .lock()
            .as_ref()
            .and_then(|map| map.get(account).cloned()))
    }
    pub fn store(account: &str, value: &str) -> Result<(), String> {
        SECRETS
            .lock()
            .get_or_insert_with(HashMap::new)
            .insert(account.into(), value.into());
        Ok(())
    }
    pub fn delete(account: &str) -> Result<(), String> {
        if let Some(map) = SECRETS.lock().as_mut() {
            map.remove(account);
        }
        Ok(())
    }
    pub fn clear() {
        *SECRETS.lock() = None;
    }
}

fn load_secrets(engine: &str, id: &str) -> Result<Secrets, String> {
    match secret_store::load(&secret_account(engine, id))? {
        Some(raw) => {
            serde_json::from_str(&raw).map_err(|_| "A saved channel key couldn't be read.".into())
        }
        None => Ok(Secrets::new()),
    }
}

fn save_secrets(engine: &str, id: &str, secrets: &Secrets) -> Result<(), String> {
    let account = secret_account(engine, id);
    if secrets.is_empty() {
        return secret_store::delete(&account);
    }
    let raw = serde_json::to_string(secrets).map_err(|e| e.to_string())?;
    secret_store::store(&account, &raw)
}

/// The channel with its secrets put back, for starting a CLI or probing its models.
fn with_secrets(engine: &str, id: &str, provider: &Value) -> Result<Value, String> {
    let mut provider = provider.clone();
    merge_secrets(&mut provider, &load_secrets(engine, id)?);
    Ok(provider)
}

// ── Resolving the channel a start uses ─────────────────────────────────────

/// Refuses a start while the engine is turned off in Settings.
pub fn ensure_engine_enabled(engine: &str) -> Result<(), String> {
    let config = read_config()?;
    let section = config
        .section(engine)
        .ok_or_else(|| format!("Unknown engine: {engine}"))?;
    if section.current.as_deref() == Some(DISABLED_PROVIDER_ID) {
        return Err(format!("{engine} is turned off in Settings"));
    }
    Ok(())
}

fn is_official_provider(id: &str) -> bool {
    id.is_empty() || id == LOCAL_PROVIDER_ID || id == LEGACY_LOCAL_CONFIG_TOML_ID
}

/// A channel by exact id, or by a prefix or suffix match (`custom_123` finds
/// `plugin_model-switcher_custom_123` and the other way round). More than one fuzzy match is an
/// error: choosing by order could send the chat to the wrong endpoint.
pub(crate) fn find_provider<'a>(
    section: &'a ProviderSection,
    id: &str,
) -> Result<Option<(&'a str, &'a Value)>, String> {
    if let Some((k, v)) = section.providers.get_key_value(id) {
        return Ok(Some((k.as_str(), v)));
    }
    let mut matches = section
        .providers
        .iter()
        .filter(|(k, _)| k.ends_with(&format!("_{id}")) || id.ends_with(&format!("_{k}")));
    let first = matches.next();
    if let Some((second, _)) = matches.next() {
        let first_key = first.map(|(k, _)| k.as_str()).unwrap_or("");
        return Err(format!(
            "Channel {id} is ambiguous: it matches {first_key} and {second}"
        ));
    }
    Ok(first.map(|(k, v)| (k.as_str(), v)))
}

/// The channel one start uses, secrets included: `provider_id` when given, else the engine's
/// current one. `None` means the CLI's own config applies.
pub(crate) fn resolve_provider(
    engine: &str,
    provider_id: Option<&str>,
) -> Result<Option<Value>, String> {
    let config = read_config()?;
    let section = config
        .section(engine)
        .ok_or_else(|| format!("Unknown engine: {engine}"))?;
    let explicit = provider_id.map(str::trim).filter(|s| !s.is_empty());
    let id = explicit.unwrap_or_else(|| section.current.as_deref().unwrap_or("").trim());
    if id == DISABLED_PROVIDER_ID {
        return Err(format!("{engine} is turned off in Settings"));
    }
    if is_official_provider(id) {
        return Ok(None);
    }
    if let Some((key, provider)) = find_provider(section, id)? {
        return with_secrets(engine, key, provider).map(Some);
    }
    if explicit.is_some() {
        // A chosen channel that no longer exists must not quietly send the chat to whatever
        // channel is current: the person picked an endpoint.
        return Err(format!("Channel {id} was not found for {engine}"));
    }
    // Only a stored current id can be stale (its channel was deleted): fall back to the official
    // config rather than fail every start.
    eprintln!(
        "[engine channels] current channel {id} not found for {engine}; using the CLI's own config"
    );
    Ok(None)
}

/// The environment a start of `engine` gets for `provider_id` (or the current channel), for tests.
#[cfg(test)]
pub fn resolve_provider_env(
    engine: &str,
    provider_id: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    resolve_provider(engine, provider_id)?
        .map(|provider| super::provider_files::channel_env(engine, &provider))
        .unwrap_or_else(|| Ok(HashMap::new()))
}

/// The provider channel's environment for `engine`. Includes what
/// [`channel_launch`] would add to the environment. An engine that is turned off, or a channel
/// that can't be read, gives nothing here; [`ensure_engine_enabled`] is the gate for that.
pub fn channel_env(engine: &str) -> HashMap<String, String> {
    match channel_launch(engine, None, None) {
        Ok(launch) => launch.env,
        Err(error) => {
            eprintln!("[engine channels] {engine}: {error}");
            HashMap::new()
        }
    }
}

/// Everything a start of `engine` on its current channel needs: environment, extra arguments and
/// the private files those arguments name (to remove when the run ends).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ChannelLaunch {
    pub env: HashMap<String, String>,
    pub args: Vec<String>,
    pub cleanup_files: Vec<std::path::PathBuf>,
    /// For Claude Code, the `--model` to pass, resolved through the channel's model aliases.
    pub model: Option<String>,
}

/// The launch for `engine` on its current channel. `model` and `effort` are the chat's own
/// choices, which win over the channel's.
///
/// Claude Code reads the `env` of its own `settings.json` after the process environment, so a
/// channel also gets a private `--settings` overlay that masks the native routing keys. Codex
/// reads its provider from `config.toml`, so a channel is applied with `-c` overrides; its key
/// travels in the environment (`MISTY_CODEX_API_KEY`), never in the arguments.
pub fn channel_launch(
    engine: &str,
    model: Option<&str>,
    effort: Option<&str>,
) -> Result<ChannelLaunch, String> {
    let Some(provider) = resolve_provider(engine, None)? else {
        return Ok(ChannelLaunch {
            model: model.map(str::to_string),
            ..Default::default()
        });
    };
    let mut launch = ChannelLaunch {
        env: super::provider_files::channel_env(engine, &provider)?,
        ..Default::default()
    };
    match engine {
        "claude" => {
            launch.model = claude_resolve_model(model, &provider, &launch.env);
            let path = claude_stage(
                &provider,
                &launch.env,
                launch.model.as_deref(),
                &support::app_home().join("claude-staging"),
            )?;
            launch.args = vec!["--settings".into(), path.to_string_lossy().into_owned()];
            launch.cleanup_files.push(path);
        }
        "codex" => {
            let mut extra = HashMap::new();
            launch.args = codex_channel_args(&provider, &launch.env, model, effort, &mut extra)?;
            launch.env.extend(extra);
            launch.model = model.map(str::to_string);
        }
        _ => launch.model = model.map(str::to_string),
    }
    Ok(launch)
}

// ── Claude Code: a private --settings overlay ───────────────────────────────

const CLAUDE_ROUTING_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
];

/// The model to pass for a channel: the chat's choice, through the channel's alias variables
/// (`sonnet` → `ANTHROPIC_DEFAULT_SONNET_MODEL`), else the channel's own model.
fn claude_resolve_model(
    selected: Option<&str>,
    provider: &Value,
    env: &HashMap<String, String>,
) -> Option<String> {
    let configured = env
        .get("ANTHROPIC_MODEL")
        .map(String::as_str)
        .or_else(|| {
            provider
                .pointer("/settingsConfig/model")
                .and_then(Value::as_str)
        })
        .filter(|model| !model.trim().is_empty());
    // "default" (or nothing chosen) means the channel's own default. With none configured there
    // is nothing to pass, and the overlay masks the native model instead.
    let selected = match selected.filter(|s| !s.trim().is_empty()) {
        None | Some("default") => configured?,
        Some(s) => s,
    };
    let wants_1m = selected.ends_with("[1m]");
    let raw = selected.strip_suffix("[1m]").unwrap_or(selected);
    let resolved = match raw {
        "opus" | "sonnet" | "haiku" | "fable" => env
            .get(&format!("ANTHROPIC_DEFAULT_{}_MODEL", raw.to_uppercase()))
            .map(String::as_str)
            .unwrap_or(raw),
        _ => raw,
    };
    Some(if wants_1m && !resolved.ends_with("[1m]") {
        format!("{resolved}[1m]")
    } else {
        resolved.to_string()
    })
}

/// `settingsConfig` keys a channel may keep in the overlay. `hooks` and `apiKeyHelper` are shell
/// commands and `permissions` rewrites the tool policy, so an imported channel must not carry
/// them into a start.
const CLAUDE_PASSTHROUGH_SETTINGS_KEYS: &[&str] = &["model", "alwaysThinkingEnabled"];

fn claude_stage(
    provider: &Value,
    env: &HashMap<String, String>,
    model: Option<&str>,
    directory: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let mut settings = Map::new();
    if let Some(source) = provider.get("settingsConfig").and_then(Value::as_object) {
        for &key in CLAUDE_PASSTHROUGH_SETTINGS_KEYS {
            if let Some(value) = source.get(key) {
                settings.insert(key.to_string(), value.clone());
            }
        }
    }
    // Empty values mask the native routing and sign-in settings; the person's hooks,
    // permissions and managed settings keep the CLI's own precedence.
    let mut overlay: Map<String, Value> = CLAUDE_ROUTING_KEYS
        .iter()
        .map(|key| (key.to_string(), Value::String(String::new())))
        .collect();
    overlay.extend(
        env.iter()
            .map(|(key, value)| (key.clone(), Value::String(value.clone()))),
    );
    settings.insert("env".into(), Value::Object(overlay));
    settings.insert(
        "model".into(),
        Value::String(
            model
                .filter(|m| !m.trim().is_empty())
                .unwrap_or("default")
                .to_string(),
        ),
    );
    // Mask a native apiKeyHelper (a shell command the CLI runs) so the channel's key wins.
    settings.insert("apiKeyHelper".into(), Value::String(String::new()));
    let content = serde_json::to_string(&settings)
        .map_err(|_| "Couldn't write the Claude Code channel settings")?;
    let path = directory.join(format!("channel-{}.json", uuid::Uuid::new_v4()));
    support::atomic_write(&path, &content)?;
    Ok(path)
}

// ── Codex: -c overrides ─────────────────────────────────────────────────────

/// The `-c key=value` arguments that apply a channel to one Codex start, and (in `env`) the
/// variables its key, bearer token and headers travel in, so they never show in a process
/// listing. The chat's own model and effort win.
fn codex_channel_args(
    provider: &Value,
    channel_env: &HashMap<String, String>,
    model: Option<&str>,
    effort: Option<&str>,
    env: &mut HashMap<String, String>,
) -> Result<Vec<String>, String> {
    use toml::Value as Toml;
    let text = provider
        .pointer("/settingsConfig/config")
        .and_then(Value::as_str)
        .unwrap_or("");
    // No parser diagnostics here: they can quote credentials from the TOML.
    let mut config: toml::Table = toml::from_str(text)
        .map_err(|_| "This Codex channel's config.toml isn't valid".to_string())?;
    let api_key = channel_env.get("OPENAI_API_KEY");
    let base_url = channel_env.get("OPENAI_BASE_URL");
    if text.trim().is_empty() {
        if let Some(model) = provider
            .get("model")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            config.insert("model".into(), Toml::String(model.into()));
        }
    }
    // A flat channel selects its own provider, even when the native file selects another.
    if !config.contains_key("model_provider") && (base_url.is_some() || api_key.is_some()) {
        config.insert("model_provider".into(), Toml::String("misty".into()));
        let table = toml::Table::from_iter([
            ("name".into(), Toml::String("Misty channel".into())),
            (
                "base_url".into(),
                Toml::String(
                    base_url
                        .cloned()
                        .unwrap_or_else(|| "https://api.openai.com/v1".into()),
                ),
            ),
            ("wire_api".into(), Toml::String("responses".into())),
        ]);
        config.insert(
            "model_providers".into(),
            Toml::Table(toml::Table::from_iter([(
                "misty".into(),
                Toml::Table(table),
            )])),
        );
    }
    if let Some(key) = api_key {
        let selected = config
            .get("model_provider")
            .and_then(Toml::as_str)
            .unwrap_or("openai")
            .to_string();
        let providers = config
            .entry("model_providers")
            .or_insert_with(|| Toml::Table(Default::default()))
            .as_table_mut()
            .ok_or("Codex channel model_providers must be a table")?;
        let table = providers
            .entry(selected.clone())
            .or_insert_with(|| Toml::Table(Default::default()))
            .as_table_mut()
            .ok_or("Codex channel provider must be a table")?;
        table
            .entry("name")
            .or_insert_with(|| Toml::String(selected));
        table.insert("env_key".into(), Toml::String("MISTY_CODEX_API_KEY".into()));
        table.insert("requires_openai_auth".into(), Toml::Boolean(false));
        table.remove("experimental_bearer_token");
        env.insert("MISTY_CODEX_API_KEY".into(), key.clone());
    }
    // A provider document may sign in with a literal bearer token or headers: move those into the
    // environment too.
    if let Some(providers) = config
        .get_mut("model_providers")
        .and_then(Toml::as_table_mut)
    {
        for (provider_index, (_, table)) in providers.iter_mut().enumerate() {
            let table = table
                .as_table_mut()
                .ok_or("Codex channel provider must be a table")?;
            if let Some(token) = table.remove("experimental_bearer_token") {
                let token = token
                    .as_str()
                    .ok_or("Codex channel bearer token must be a string")?;
                let key = format!("MISTY_CODEX_BEARER_{provider_index}");
                env.insert(key.clone(), token.to_string());
                table.insert("env_key".into(), Toml::String(key));
                table.insert("requires_openai_auth".into(), Toml::Boolean(false));
            }
            if let Some(headers) = table.remove("http_headers") {
                let headers = headers
                    .as_table()
                    .ok_or("Codex channel headers must be a table")?;
                let env_headers = table
                    .entry("env_http_headers")
                    .or_insert_with(|| Toml::Table(Default::default()))
                    .as_table_mut()
                    .ok_or("Codex channel env headers must be a table")?;
                for (header_index, (header, value)) in headers.iter().enumerate() {
                    let value = value
                        .as_str()
                        .ok_or("Codex channel header must be a string")?;
                    let key = env_headers
                        .entry(header.clone())
                        .or_insert_with(|| {
                            Toml::String(format!(
                                "MISTY_CODEX_HEADER_{provider_index}_{header_index}"
                            ))
                        })
                        .as_str()
                        .ok_or("Codex channel header variable must be a string")?;
                    // Keep the CLI's rule that a header variable wins over a literal header.
                    if !channel_env.contains_key(key) && std::env::var_os(key).is_none() {
                        env.insert(key.to_string(), value.to_string());
                    }
                }
            }
        }
    }
    // The person's own hooks, trust and MCP settings stay; only the provider keys are replaced.
    // `disable_response_storage` is retired by current Codex versions and isn't passed.
    let mut args = Vec::new();
    for key in [
        "model",
        "model_provider",
        "model_reasoning_effort",
        "model_context_window",
        "model_auto_compact_token_limit",
        "preferred_auth_method",
        "model_providers",
    ] {
        if (key == "model" && model.is_some())
            || (key == "model_reasoning_effort" && effort.is_some())
        {
            continue;
        }
        if let Some(value) = config.get(key) {
            args.push("-c".into());
            args.push(format!("{key}={value}"));
        }
    }
    Ok(args)
}

// ── What a window sees ──────────────────────────────────────────────────────

/// One channel as Settings shows it: everything but its secrets.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelView {
    pub id: String,
    pub config: Value,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineChannels {
    pub engine: String,
    pub channels: Vec<ChannelView>,
    pub current: Option<String>,
    pub enabled: bool,
}

pub fn channels_view() -> Result<Vec<EngineChannels>, String> {
    let config = read_config()?;
    ENGINES
        .iter()
        .map(|engine| {
            let section = config.section(engine).expect("known engine");
            let channels = section
                .ordered_ids()
                .into_iter()
                .map(|id| {
                    let has_key = !load_secrets(engine, &id)?.is_empty();
                    Ok(ChannelView {
                        config: section.providers.get(&id).cloned().unwrap_or(Value::Null),
                        id,
                        has_key,
                    })
                })
                .collect::<Result<_, String>>()?;
            Ok(EngineChannels {
                engine: engine.to_string(),
                channels,
                current: section.current.clone(),
                enabled: section.current.as_deref() != Some(DISABLED_PROVIDER_ID),
            })
        })
        .collect()
}

// ── Changes ─────────────────────────────────────────────────────────────────

/// Applies `mutate` to one engine's channels and saves, for a caller already holding [`lock`].
/// An error from `mutate` leaves everything as it was.
pub(crate) fn mutate_section_unlocked(
    engine: &str,
    mutate: impl FnOnce(&mut ProviderSection) -> Result<(), String>,
) -> Result<(), String> {
    let mut config = read_config()?;
    let section = config
        .section_mut(engine)
        .ok_or_else(|| format!("Unknown engine: {engine}"))?;
    mutate(section)?;
    write_config(&config)
}

fn mutate_section(
    engine: &str,
    mutate: impl FnOnce(&mut ProviderSection) -> Result<(), String>,
) -> Result<(), String> {
    let _guard = lock();
    mutate_section_unlocked(engine, mutate)
}

/// Adds or replaces a channel, for a caller holding [`lock`]. Secrets in `json` go to the
/// credential store and replace the ones saved under the same field; saved ones the edit doesn't
/// carry are kept, since a window never has them to send back.
pub(crate) fn upsert_provider_unlocked(
    engine: &str,
    id: &str,
    mut json: Value,
) -> Result<(), String> {
    if id.trim().is_empty() || id == LOCAL_PROVIDER_ID || id == DISABLED_PROVIDER_ID {
        return Err("That channel id can't be used.".into());
    }
    let incoming = split_secrets(&mut json);
    let clear = json
        .as_object_mut()
        .and_then(|map| map.remove("clearKey"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let mut secrets = if clear {
        Secrets::new()
    } else {
        load_secrets(engine, id)?
    };
    secrets.extend(incoming);
    mutate_section_unlocked(engine, |section| {
        section.insert(id.to_string(), json);
        Ok(())
    })?;
    save_secrets(engine, id, &secrets)
}

pub fn upsert_provider(engine: &str, id: &str, json: Value) -> Result<(), String> {
    let _guard = lock();
    upsert_provider_unlocked(engine, id, json)
}

/// Removes a channel and its secrets, for a caller holding [`lock`].
pub(crate) fn delete_provider_unlocked(engine: &str, id: &str) -> Result<(), String> {
    mutate_section_unlocked(engine, |section| {
        section.remove(id);
        if section.current.as_deref() == Some(id) {
            // Back to the official config: a start then adds nothing.
            section.current = None;
        }
        Ok(())
    })?;
    save_secrets(engine, id, &Secrets::new())
}

pub fn delete_provider(engine: &str, id: &str) -> Result<(), String> {
    let _guard = lock();
    delete_provider_unlocked(engine, id)
}

/// Turning an engine off remembers its channel in `disabled_from` and parks `current` on
/// `__disabled__`; turning it on brings the channel back (or the official config when it was
/// deleted meanwhile).
pub fn set_engine_enabled(engine: &str, enabled: bool) -> Result<(), String> {
    mutate_section(engine, |section| {
        if enabled {
            if section.current.as_deref() == Some(DISABLED_PROVIDER_ID) {
                let restore = section
                    .disabled_from
                    .take()
                    .filter(|id| id != DISABLED_PROVIDER_ID && section.providers.contains_key(id));
                section.current = Some(restore.unwrap_or_else(|| LOCAL_PROVIDER_ID.to_string()));
            }
        } else if section.current.as_deref() != Some(DISABLED_PROVIDER_ID) {
            section.disabled_from = section.current.clone();
            section.current = Some(DISABLED_PROVIDER_ID.to_string());
        }
        Ok(())
    })
}

/// The channel new chats of `engine` start on. Chats already running keep theirs; the CLI's own
/// files are never written.
pub fn set_current_provider(engine: &str, id: &str) -> Result<(), String> {
    mutate_section(engine, |section| {
        if id != LOCAL_PROVIDER_ID
            && id != DISABLED_PROVIDER_ID
            && id != LEGACY_LOCAL_CONFIG_TOML_ID
        {
            if let Some((matched_key, _)) = find_provider(section, id)? {
                section.current = Some(matched_key.to_string());
                return Ok(());
            }
            return Err(format!("Channel {id} was not found for {engine}"));
        }
        section.current = Some(id.to_string());
        Ok(())
    })
}

pub fn reorder_providers(engine: &str, ids: Vec<String>) -> Result<(), String> {
    mutate_section(engine, |section| {
        // The requested order, then any channel it doesn't name.
        let mut order: Vec<String> = ids
            .into_iter()
            .filter(|id| section.providers.contains_key(id))
            .collect();
        for id in section.ordered_ids() {
            if !order.contains(&id) {
                order.push(id);
            }
        }
        section.order = order;
        Ok(())
    })
}

// ── Commands ────────────────────────────────────────────────────────────────

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn engine_channels_list() -> Result<Vec<EngineChannels>, String> {
    blocking(channels_view).await
}

#[tauri::command]
pub async fn engine_channels_upsert(engine: String, id: String, json: Value) -> Result<(), String> {
    blocking(move || upsert_provider(&checked_engine(&engine)?, &id, json)).await
}

#[tauri::command]
pub async fn engine_channels_delete(engine: String, id: String) -> Result<(), String> {
    blocking(move || delete_provider(&checked_engine(&engine)?, &id)).await
}

#[tauri::command]
pub async fn engine_channels_set_enabled(engine: String, enabled: bool) -> Result<(), String> {
    blocking(move || set_engine_enabled(&checked_engine(&engine)?, enabled)).await
}

#[tauri::command]
pub async fn engine_channels_set_current(engine: String, id: String) -> Result<(), String> {
    blocking(move || set_current_provider(&checked_engine(&engine)?, &id)).await
}

#[tauri::command]
pub async fn engine_channels_reorder(engine: String, ids: Vec<String>) -> Result<(), String> {
    blocking(move || reorder_providers(&checked_engine(&engine)?, ids)).await
}

/// The base URL and key of a saved channel, for the model-list probe. Stays in native code.
pub(crate) fn probe_config(
    engine: &str,
    id: &str,
) -> Result<super::provider_files::SafeProviderProbeConfig, String> {
    let config = read_config()?;
    let section = config
        .section(engine)
        .ok_or_else(|| format!("Unknown engine: {engine}"))?;
    let (key, provider) = find_provider(section, id)?
        .ok_or_else(|| format!("Channel {id} was not found for {engine}"))?;
    let provider = with_secrets(engine, key, provider)?;
    Ok(super::provider_files::safe_provider_probe_config(
        engine, &provider,
    ))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods, clippy::disallowed_types)]
    use super::*;
    use serde_json::json;

    struct Scratch {
        dir: std::path::PathBuf,
        _home: support::TestHome,
    }

    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("misty-channels-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let home = support::TestHome::set(&dir);
            secret_store::clear();
            Self { dir, _home: home }
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn seed_channel(engine: &str, id: &str, current: Option<&str>, provider: Value) {
        upsert_provider(engine, id, provider).unwrap();
        if let Some(current) = current {
            mutate_section(engine, |section| {
                section.current = Some(current.into());
                Ok(())
            })
            .unwrap();
        }
    }

    #[test]
    fn resolve_provider_env_official_is_empty_and_claude_injects() {
        let _scratch = Scratch::new();
        seed_channel(
            "claude",
            "chan-a",
            Some("chan-a"),
            json!({ "baseUrl": "https://a.example", "apiKey": "sk-a", "model": "m-a" }),
        );
        let env = resolve_provider_env("claude", Some("chan-a")).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://a.example")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-a")
        );
        assert_eq!(env.get("ANTHROPIC_MODEL").map(String::as_str), Some("m-a"));
        assert!(resolve_provider_env("claude", Some(LOCAL_PROVIDER_ID))
            .unwrap()
            .is_empty());
        // An empty id falls back to the current channel.
        let empty = resolve_provider_env("claude", Some("")).unwrap();
        assert_eq!(
            empty.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://a.example")
        );
        assert_eq!(
            channel_env("claude")
                .get("ANTHROPIC_AUTH_TOKEN")
                .map(String::as_str),
            Some("sk-a")
        );
    }

    #[test]
    fn keys_never_reach_the_stored_list_or_a_window() {
        let _scratch = Scratch::new();
        seed_channel(
            "claude",
            "chan",
            None,
            json!({
                "name": "Relay",
                "apiKey": "sk-secret",
                "settingsConfig": { "env": {
                    "ANTHROPIC_AUTH_TOKEN": "sk-env",
                    "ANTHROPIC_BASE_URL": "https://relay.example"
                } },
            }),
        );
        let stored = serde_json::to_string(&read_config().unwrap()).unwrap();
        assert!(!stored.contains("sk-secret") && !stored.contains("sk-env"));
        assert!(stored.contains("https://relay.example"));
        let view = channels_view().unwrap();
        let claude = view.iter().find(|e| e.engine == "claude").unwrap();
        assert!(claude.channels[0].has_key);
        assert!(!serde_json::to_string(&view).unwrap().contains("sk-"));

        // An edit without the key keeps it; a new key replaces it; clearKey removes it.
        upsert_provider(
            "claude",
            "chan",
            json!({ "name": "Renamed", "baseUrl": "https://b.example" }),
        )
        .unwrap();
        let env = resolve_provider_env("claude", Some("chan")).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-env")
        );
        upsert_provider("claude", "chan", json!({ "apiKey": "sk-new" })).unwrap();
        let provider = resolve_provider("claude", Some("chan")).unwrap().unwrap();
        assert_eq!(provider["apiKey"], "sk-new");
        upsert_provider("claude", "chan", json!({ "clearKey": true })).unwrap();
        let view = channels_view().unwrap();
        assert!(!view.iter().find(|e| e.engine == "claude").unwrap().channels[0].has_key);
        delete_provider("claude", "chan").unwrap();
        assert!(load_secrets("claude", "chan").unwrap().is_empty());
    }

    #[test]
    fn resolve_provider_env_disabled_errors() {
        let _scratch = Scratch::new();
        seed_channel("kimi", "chan-a", Some(DISABLED_PROVIDER_ID), json!({}));
        assert!(resolve_provider_env("kimi", Some(DISABLED_PROVIDER_ID)).is_err());
        assert!(ensure_engine_enabled("kimi").is_err());
        assert!(channel_env("kimi").is_empty());
    }

    #[test]
    fn resolve_provider_env_matches_plugin_prefix_and_falls_back() {
        let _scratch = Scratch::new();
        seed_channel(
            "claude",
            "plugin_model-switcher_custom_1789366959743",
            Some("plugin_model-switcher_custom_1789366959743"),
            json!({ "baseUrl": "https://tobapi.example.com", "apiKey": "sk-test" }),
        );
        let env = resolve_provider_env("claude", Some("custom_1789366959743")).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://tobapi.example.com")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-test")
        );
        // A stale explicit id fails rather than quietly using whatever is current.
        let stale = resolve_provider_env("claude", Some("deleted_channel_123"));
        assert!(stale.unwrap_err().contains("deleted_channel_123"));
    }

    #[test]
    fn find_provider_fails_on_ambiguous_suffix_match() {
        let mut section = ProviderSection::default();
        section.insert(
            "plugin_a_custom_1".into(),
            json!({"baseUrl": "https://a.example"}),
        );
        section.insert(
            "plugin_b_custom_1".into(),
            json!({"baseUrl": "https://b.example"}),
        );
        assert!(find_provider(&section, "custom_1").is_err());
        section.insert(
            "custom_1".into(),
            json!({"baseUrl": "https://exact.example"}),
        );
        let (key, _) = find_provider(&section, "custom_1").unwrap().unwrap();
        assert_eq!(key, "custom_1");
    }

    #[test]
    fn switching_never_writes_native_files_and_order_is_kept() {
        let _scratch = Scratch::new();
        for engine in ENGINES {
            seed_channel(
                engine,
                "chan-a",
                None,
                json!({"baseUrl":"https://a.example", "apiKey":"sk-a"}),
            );
            let paths = super::super::provider_files::provider_file_paths(engine);
            for path in &paths {
                std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
                std::fs::write(path, "# the person's own config\n").unwrap();
            }
            for id in ["chan-a", LOCAL_PROVIDER_ID, "chan-a"] {
                set_current_provider(engine, id).unwrap();
                assert_eq!(
                    read_config()
                        .unwrap()
                        .section(engine)
                        .unwrap()
                        .current
                        .as_deref(),
                    Some(id)
                );
            }
            assert!(set_current_provider(engine, "missing").is_err());
            set_engine_enabled(engine, false).unwrap();
            assert!(ensure_engine_enabled(engine).is_err());
            set_engine_enabled(engine, true).unwrap();
            assert_eq!(
                read_config()
                    .unwrap()
                    .section(engine)
                    .unwrap()
                    .current
                    .as_deref(),
                Some("chan-a")
            );
            delete_provider(engine, "chan-a").unwrap();
            for path in &paths {
                assert_eq!(
                    std::fs::read_to_string(path).unwrap(),
                    "# the person's own config\n",
                    "{engine}: {path}"
                );
            }
        }
        for id in ["z", "a", "m"] {
            seed_channel("codex", id, None, json!({}));
        }
        assert_eq!(
            read_config()
                .unwrap()
                .section("codex")
                .unwrap()
                .ordered_ids(),
            ["z", "a", "m"]
        );
        reorder_providers("codex", vec!["m".into(), "z".into()]).unwrap();
        assert_eq!(
            read_config()
                .unwrap()
                .section("codex")
                .unwrap()
                .ordered_ids(),
            ["m", "z", "a"]
        );
    }

    #[test]
    fn claude_launch_stages_a_private_overlay() {
        let _scratch = Scratch::new();
        seed_channel(
            "claude",
            "relay",
            Some("relay"),
            json!({
                "baseUrl": "https://relay.example",
                "apiKey": "sk-relay",
                "env": { "ANTHROPIC_DEFAULT_SONNET_MODEL": "relay-sonnet" },
                "settingsConfig": { "hooks": { "x": 1 }, "alwaysThinkingEnabled": true },
            }),
        );
        let launch = channel_launch("claude", Some("sonnet"), None).unwrap();
        assert_eq!(launch.model.as_deref(), Some("relay-sonnet"));
        assert_eq!(launch.args[0], "--settings");
        let staged: Value =
            serde_json::from_str(&std::fs::read_to_string(&launch.args[1]).unwrap()).unwrap();
        assert_eq!(staged["env"]["ANTHROPIC_BASE_URL"], "https://relay.example");
        assert_eq!(staged["env"]["CLAUDE_CODE_OAUTH_TOKEN"], "");
        assert_eq!(staged["apiKeyHelper"], "");
        assert_eq!(staged["alwaysThinkingEnabled"], true);
        assert!(staged.get("hooks").is_none());
        assert_eq!(launch.cleanup_files.len(), 1);
    }

    #[test]
    fn claude_models_resolve_through_channel_aliases() {
        let provider = json!({"model": "sonnet", "settingsConfig": {"model": "haiku"}});
        let env = HashMap::from([
            ("ANTHROPIC_MODEL".into(), "sonnet".into()),
            (
                "ANTHROPIC_DEFAULT_SONNET_MODEL".into(),
                "relay-model".into(),
            ),
        ]);
        for (selected, expected) in [
            (None, "relay-model"),
            (Some("default"), "relay-model"),
            (Some("sonnet"), "relay-model"),
            (Some("sonnet[1m]"), "relay-model[1m]"),
            (Some("custom-id"), "custom-id"),
            (Some("opus"), "opus"),
        ] {
            assert_eq!(
                claude_resolve_model(selected, &provider, &env).as_deref(),
                Some(expected)
            );
        }
        assert_eq!(
            claude_resolve_model(None, &json!({}), &HashMap::new()),
            None
        );
    }

    #[test]
    fn codex_flat_channel_selects_its_own_provider_with_the_key_in_env() {
        let _scratch = Scratch::new();
        seed_channel(
            "codex",
            "flat",
            Some("flat"),
            json!({ "baseUrl": "https://relay.example/v1", "apiKey": "sk-codex", "model": "gpt-x" }),
        );
        let launch = channel_launch("codex", None, None).unwrap();
        assert_eq!(
            launch.env.get("MISTY_CODEX_API_KEY").map(String::as_str),
            Some("sk-codex")
        );
        let joined = launch.args.join(" ");
        assert!(joined.contains("model_provider=\"misty\""), "{joined}");
        assert!(joined.contains("model=\"gpt-x\""), "{joined}");
        assert!(joined.contains("https://relay.example/v1"), "{joined}");
        assert!(
            !joined.contains("sk-codex"),
            "keys never ride the arguments"
        );
        // The chat's own model wins.
        let launch = channel_launch("codex", Some("chosen"), Some("high")).unwrap();
        assert!(!launch.args.iter().any(|arg| arg.starts_with("model=")));
    }

    #[test]
    fn codex_document_tokens_and_headers_move_to_env() {
        let _scratch = Scratch::new();
        let config = "model_provider = \"relay\"\nmodel = \"channel-model\"\nmodel_reasoning_effort = \"low\"\n[model_providers.relay]\nname = \"Relay\"\nbase_url = \"https://relay.example/v1\"\nexperimental_bearer_token = \"tok-1\"\n[model_providers.relay.http_headers]\nX-Route = \"secret-route\"\n";
        seed_channel(
            "codex",
            "doc",
            Some("doc"),
            json!({ "settingsConfig": { "config": config } }),
        );
        // The whole document is a secret here, so the stored list doesn't carry the token.
        assert!(!serde_json::to_string(&read_config().unwrap())
            .unwrap()
            .contains("tok-1"));
        let launch = channel_launch("codex", None, None).unwrap();
        let joined = launch.args.join(" ");
        assert!(
            !joined.contains("tok-1") && !joined.contains("secret-route"),
            "{joined}"
        );
        assert_eq!(
            launch.env.get("MISTY_CODEX_BEARER_0").map(String::as_str),
            Some("tok-1")
        );
        assert_eq!(
            launch.env.get("MISTY_CODEX_HEADER_0_0").map(String::as_str),
            Some("secret-route")
        );
        assert!(joined.contains("model_reasoning_effort=\"low\""));
    }

    #[test]
    fn secrets_split_and_merge_round_trip() {
        let original = json!({
            "name": "x",
            "apiKey": "k1",
            "env": { "FOO_API_KEY": "k2", "PLAIN": "p" },
            "settingsConfig": { "auth": { "OPENAI_API_KEY": "k3" }, "env": { "a/b~TOKEN": "k4" } },
        });
        let mut stripped = original.clone();
        let secrets = split_secrets(&mut stripped);
        assert_eq!(secrets.len(), 4);
        assert!(!stripped.to_string().contains("k1"));
        assert_eq!(stripped["env"]["PLAIN"], "p");
        merge_secrets(&mut stripped, &secrets);
        assert_eq!(stripped, original);
    }
}
