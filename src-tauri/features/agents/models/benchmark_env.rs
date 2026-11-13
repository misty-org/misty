//! `~/.misty/.env/client/agents.env`: keys and models for benchmark runs, so they don't have to be
//! entered in Settings on each copy of the app. A debug build reads it only when started with
//! `MISTY_AGENTS_ENV=1`, and a release never does. It's never copied into the credential store or a
//! person's settings. Everyone else's models come from Settings › Models.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use serde_json::Value;

use file_access::{self, fs};

const SWITCH: &str = "MISTY_AGENTS_ENV";

/// Each provider's key, by the name it has in the file.
const KEY_NAMES: [(&str, &str); 12] = [
    ("openai", "OPENAI_API_KEY"),
    ("anthropic", "ANTHROPIC_API_KEY"),
    ("google", "GOOGLE_API_KEY"),
    ("openrouter", "OPENROUTER_API_KEY"),
    ("gateway", "AI_GATEWAY_API_KEY"),
    ("nvidia", "NVIDIA_API_KEY"),
    ("ollama-cloud", "OLLAMA_API_KEY"),
    ("openai-compatible", "OPENAI_COMPATIBLE_API_KEY"),
    ("elevenlabs", "ELEVENLABS_API_KEY"),
    ("soniox", "SONIOX_API_KEY"),
    ("decodo", "DECODO_API_KEY"),
    ("serper", "SERPER_API_KEY"),
];

/// Each device setting, by the name it has in the file.
const SETTING_NAMES: [(&str, &str); 8] = [
    ("agent_model", "MISTY_AGENT_MODEL"),
    ("fast_model", "MISTY_FAST_MODEL"),
    ("embedding_model", "MISTY_EMBEDDING_MODEL"),
    ("transcription_model", "MISTY_TRANSCRIPTION_MODEL"),
    ("speech_model", "MISTY_SPEECH_MODEL"),
    ("speech_voice", "MISTY_SPEECH_VOICE"),
    ("search_provider", "MISTY_SEARCH_PROVIDER"),
    ("reasoning", "MISTY_REASONING"),
];

fn parse(contents: &str) -> HashMap<String, String> {
    contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let line = line.strip_prefix("export ").unwrap_or(line);
            let (name, value) = line.split_once('=').filter(|_| !line.starts_with('#'))?;
            let value = value.trim();
            let unquoted = ['"', '\'']
                .iter()
                .find_map(|quote| value.strip_prefix(*quote)?.strip_suffix(*quote))
                .unwrap_or(value);
            (!unquoted.is_empty()).then(|| (name.trim().to_owned(), unquoted.to_owned()))
        })
        .collect()
}

fn file_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".misty/.env/client/agents.env"))
}

/// A file others can read is refused, since it holds keys.
fn read_private(path: &Path) -> Result<HashMap<String, String>, String> {
    file_access::allow_benchmark_keys(path);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::symlink_metadata(path).map_err(|_| "it couldn't be read".to_owned())?;
        if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o077 != 0 {
            return Err("it must be a private file: run chmod 600 on it".to_owned());
        }
    }
    let contents = fs::read_to_string(path).map_err(|_| "it couldn't be read".to_owned())?;
    Ok(parse(&contents))
}

fn values() -> Option<&'static HashMap<String, String>> {
    static VALUES: OnceLock<Option<HashMap<String, String>>> = OnceLock::new();
    VALUES
        .get_or_init(|| {
            if !cfg!(debug_assertions) || std::env::var_os(SWITCH).is_none_or(|on| on != "1") {
                return None;
            }
            let path = file_path()?;
            match read_private(&path) {
                Ok(values) => Some(values),
                Err(reason) => {
                    eprintln!("Not using {}: {reason}.", path.display());
                    None
                }
            }
        })
        .as_ref()
}

fn key_in(values: &HashMap<String, String>, provider: &str) -> Option<String> {
    let (_, name) = KEY_NAMES.iter().find(|(id, _)| *id == provider)?;
    values.get(*name).cloned()
}

fn settings_with(values: &HashMap<String, String>, mut settings: Value) -> Value {
    if !settings.is_object() {
        settings = Value::Object(Default::default());
    }
    for (setting, name) in SETTING_NAMES {
        if let Some(value) = values.get(name) {
            settings[setting] = Value::String(value.clone());
        }
    }
    settings
}

/// A provider's key from the file, on a benchmark run.
pub fn key(provider: &str) -> Option<String> {
    key_in(values()?, provider)
}

/// The device's model settings with the file's on top, on a benchmark run.
pub fn settings(settings: Value) -> Value {
    match values() {
        Some(values) => settings_with(values, settings),
        None => settings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_forms_an_env_file_takes() {
        let values = parse(
            "# a comment\n\nNVIDIA_API_KEY=abc\nexport SONIOX_API_KEY='def'\nMISTY_REASONING=\"low\"\nEMPTY=\nnot a line\nURL=a=b\n",
        );
        assert_eq!(values["NVIDIA_API_KEY"], "abc");
        assert_eq!(values["SONIOX_API_KEY"], "def");
        assert_eq!(values["MISTY_REASONING"], "low");
        assert_eq!(values["URL"], "a=b");
        assert!(!values.contains_key("EMPTY"), "an empty value means none");
        assert_eq!(values.len(), 4);
    }

    #[test]
    fn the_files_settings_go_over_the_devices_and_leave_the_rest() {
        let values = parse("MISTY_AGENT_MODEL=nvidia/x\nNVIDIA_API_KEY=abc\n");
        let merged = settings_with(
            &values,
            json!({ "agent_model": "openai/y", "fast_model": "openai/z" }),
        );
        assert_eq!(merged["agent_model"], "nvidia/x");
        assert_eq!(merged["fast_model"], "openai/z");
        assert!(merged.get("NVIDIA_API_KEY").is_none());
        assert_eq!(
            settings_with(&values, Value::Null)["agent_model"],
            "nvidia/x"
        );
    }

    #[test]
    fn a_key_goes_only_to_its_own_provider() {
        let values = parse("NVIDIA_API_KEY=abc\n");
        assert_eq!(key_in(&values, "nvidia").as_deref(), Some("abc"));
        assert_eq!(key_in(&values, "openai"), None);
        assert_eq!(key_in(&values, "unknown"), None);
    }

    #[test]
    fn a_key_file_others_can_read_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("agents.env");
        std::fs::write(&path, "NVIDIA_API_KEY=abc\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_private(&path).is_err());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(read_private(&path).unwrap()["NVIDIA_API_KEY"], "abc");
    }

    #[test]
    fn every_key_name_is_a_real_provider() {
        for (id, _) in KEY_NAMES {
            assert!(
                crate::agents::models::header::is_provider(id)
                    || crate::agents::models::header::SEARCH_PROVIDERS.contains(&id),
                "{id}"
            );
        }
    }
}
