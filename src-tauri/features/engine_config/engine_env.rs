// An engine's own environment variables: the ones the person sets for a CLI in the Agents
// window, added to its environment each time Misty starts it.
//
// They belong to this computer and never sync. Since any of them may hold a key, every value is
// kept in the credential store, sealed under the master key in the OS keychain, one entry per
// engine. Windows read back the names, and the values of those whose names don't look secret;
// a secret's value only ever goes into the CLI's environment. A provider channel chosen for a
// chat is more specific, so its variables win over these.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use super::support;

/// Name → value, as kept in the credential store.
type Vars = BTreeMap<String, String>;

const MAX_VARS: usize = 64;
const MAX_VALUE_BYTES: usize = 32 * 1024;

fn account(engine: &str) -> String {
    format!("env/{engine}")
}

/// An engine id as the app writes them (`claude`, `qoder-cn`), never a path or anything else.
fn checked_engine(engine: &str) -> Result<String, String> {
    let engine = engine.trim();
    let valid = !engine.is_empty()
        && engine.len() <= 32
        && engine
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if valid {
        Ok(engine.to_string())
    } else {
        Err(format!("Unknown engine: {engine}"))
    }
}

/// A POSIX variable name. PATH is Misty's: it finds the CLI's interpreter with it.
fn checked_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let mut chars = name.chars();
    let valid = name.len() <= 128
        && chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err("Use letters, digits and underscores, starting with a letter.".into());
    }
    if name.eq_ignore_ascii_case("PATH") {
        return Err("PATH is set by Misty so the CLI can find its tools.".into());
    }
    Ok(name.to_string())
}

fn checked_value(value: &str) -> Result<(), String> {
    if value.contains('\0') {
        return Err("The value can't contain a null character.".into());
    }
    if value.len() > MAX_VALUE_BYTES {
        return Err("The value is too long.".into());
    }
    Ok(())
}

/// Whether a variable named `name` holds a secret, by the same words channels use.
fn is_secret(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    ["KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "AUTH"]
        .iter()
        .any(|word| upper.contains(word))
}

fn load(engine: &str) -> Result<Vars, String> {
    match support::load_secret(&account(engine))? {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|_| "The saved environment variables couldn't be read.".into()),
        None => Ok(Vars::new()),
    }
}

fn save(engine: &str, vars: &Vars) -> Result<(), String> {
    if vars.is_empty() {
        return support::delete_secret(&account(engine));
    }
    let raw = serde_json::to_string(vars).map_err(|e| e.to_string())?;
    support::store_secret(&account(engine), &raw)
}

/// The variables the person set for `engine`, for its start. Empty when there are none.
pub fn env_for(engine: &str) -> Result<HashMap<String, String>, String> {
    let Ok(engine) = checked_engine(engine) else {
        return Ok(HashMap::new());
    };
    Ok(load(&engine)?.into_iter().collect())
}

/// One variable as a window sees it: a secret's value never leaves native code.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVarView {
    pub name: String,
    pub secret: bool,
    pub value: Option<String>,
}

fn view(vars: &Vars) -> Vec<EnvVarView> {
    vars.iter()
        .map(|(name, value)| {
            let secret = is_secret(name);
            EnvVarView {
                name: name.clone(),
                secret,
                value: (!secret).then(|| value.clone()),
            }
        })
        .collect()
}

fn set(
    engine: &str,
    name: &str,
    value: &str,
    previous: Option<&str>,
) -> Result<Vec<EnvVarView>, String> {
    let engine = checked_engine(engine)?;
    let name = checked_name(name)?;
    checked_value(value)?;
    let mut vars = load(&engine)?;
    // A rename moves the value: the old name goes once the new one is stored.
    if let Some(previous) = previous
        .map(str::trim)
        .filter(|p| !p.is_empty() && *p != name)
    {
        vars.remove(previous);
    }
    if !vars.contains_key(&name) && vars.len() >= MAX_VARS {
        return Err(format!("An engine can have at most {MAX_VARS} variables."));
    }
    vars.insert(name, value.to_string());
    save(&engine, &vars)?;
    Ok(view(&vars))
}

fn remove(engine: &str, name: &str) -> Result<Vec<EnvVarView>, String> {
    let engine = checked_engine(engine)?;
    let mut vars = load(&engine)?;
    vars.remove(name.trim());
    save(&engine, &vars)?;
    Ok(view(&vars))
}

fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can do this.".into())
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn engine_env_list(
    webview: tauri::Webview,
    engine: String,
) -> Result<Vec<EnvVarView>, String> {
    person_window(&webview)?;
    blocking(move || {
        let engine = checked_engine(&engine)?;
        Ok(view(&load(&engine)?))
    })
    .await
}

/// Sets `name` to `value`; `previous` is the name it had, when the person renamed it.
#[tauri::command]
pub async fn engine_env_set(
    webview: tauri::Webview,
    engine: String,
    name: String,
    value: String,
    previous: Option<String>,
) -> Result<Vec<EnvVarView>, String> {
    person_window(&webview)?;
    blocking(move || set(&engine, &name, &value, previous.as_deref())).await
}

#[tauri::command]
pub async fn engine_env_remove(
    webview: tauri::Webview,
    engine: String,
    name: String,
) -> Result<Vec<EnvVarView>, String> {
    person_window(&webview)?;
    blocking(move || remove(&engine, &name)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_posix_and_never_path() {
        assert_eq!(checked_name(" FOO_BAR1 ").unwrap(), "FOO_BAR1");
        assert!(checked_name("_x").is_ok());
        assert!(checked_name("1FOO").is_err());
        assert!(checked_name("FOO-BAR").is_err());
        assert!(checked_name("").is_err());
        assert!(checked_name("Path").is_err());
    }

    #[test]
    fn engines_are_plain_ids() {
        assert_eq!(checked_engine("qoder-cn").unwrap(), "qoder-cn");
        assert!(checked_engine("../claude").is_err());
        assert!(checked_engine("Claude").is_err());
    }

    #[test]
    fn secrets_never_reach_a_window() {
        let mut vars = Vars::new();
        vars.insert("ANTHROPIC_API_KEY".into(), "sk-1".into());
        vars.insert("HTTPS_PROXY".into(), "http://proxy".into());
        let shown = view(&vars);
        let key = shown
            .iter()
            .find(|v| v.name == "ANTHROPIC_API_KEY")
            .unwrap();
        assert!(key.secret && key.value.is_none());
        let proxy = shown.iter().find(|v| v.name == "HTTPS_PROXY").unwrap();
        assert_eq!(proxy.value.as_deref(), Some("http://proxy"));
    }

    #[test]
    fn values_refuse_nulls() {
        assert!(checked_value("a\0b").is_err());
        assert!(checked_value("ok").is_ok());
    }
}
