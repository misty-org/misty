//! `~/.misty/misty.conf`: which data folder this install opens, and the defaults new settings
//! start from. It is mostly for developing Misty; most people never open it.
//!
//! ```text
//! [metadata]
//! misty.manifest = v1
//! misty.root = ~/.misty/dev/default
//!
//! [defaults]
//! general.auto_update_enabled = false
//! ```
//!
//! - `misty.manifest` is the layout the folders follow. `v1` is `dev/<kind>` for debug builds,
//!   `rel/<version>` for releases and `shared/` for what they share (see `paths`).
//! - `misty.root` is the data folder to open. It is always a folder inside `~/.misty/dev` or
//!   `~/.misty/rel`, never anywhere else and never a link: anything else stops Misty at launch.
//! - `[defaults]` takes a settings key (`section.key`, as in `misty.db`) in place of Misty's own
//!   default when a folder's settings fill in a key they don't have yet. A value already there is
//!   never changed, so it seeds new folders and new settings and overrides nothing.
//! - `[client]`, `[server]` and `[cli]` are environment defaults for the desktop app,
//!   misty-server and misty-cli: a name there is used only when neither the process nor the
//!   folder's `.env` sets it, so each works without a `.env` at all. Never secrets: those stay in
//!   `.env`, and a name that looks like one (`*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`,
//!   `PRIVATE…`) makes the file one Misty won't read.
//!
//! Lines are `key = value`; `#` starts a comment. Unknown sections and keys are left alone.
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use crate::paths;

/// The file's name in `~/.misty`.
pub const FILE_NAME: &str = "misty.conf";
/// The layout this build reads and writes.
pub const MANIFEST: &str = "v1";

/// What `misty.conf` says.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Conf {
    /// `[metadata] misty.manifest`.
    pub manifest: Option<String>,
    /// `[metadata] misty.root`, as written.
    pub root: Option<String>,
    /// `[defaults]`, in order: `("general.auto_update_enabled", "false")`.
    pub defaults: Vec<(String, String)>,
    /// `[client]`, `[server]` and `[cli]`, each in order, in the order they first appear.
    pub overrides: Vec<(String, Vec<(String, String)>)>,
}

/// The sections holding one program's environment defaults each.
pub const OVERRIDE_SECTIONS: &[&str] = &["client", "server", "cli"];

/// Names the desktop app settles from `misty.conf` itself, never from `[client]`.
const OWN_NAMES: &[&str] = &["MISTY_PROFILE", "MISTY_DATA_ROOT"];

/// Whether an environment name reads like a secret, which belongs in `.env`, never here.
pub fn looks_secret(name: &str) -> bool {
    let name = name.to_ascii_uppercase();
    ["_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_PASS"]
        .iter()
        .any(|suffix| name.ends_with(suffix))
        || ["PRIVATE", "SECRET", "PASSWORD"]
            .iter()
            .any(|word| name.contains(word))
}

impl Conf {
    /// One program's environment defaults (`client`, `server` or `cli`).
    pub fn overrides_for(&self, section: &str) -> &[(String, String)] {
        self.overrides
            .iter()
            .find(|(name, _)| name == section)
            .map_or(&[], |(_, entries)| entries.as_slice())
    }

    /// The `[defaults]` value for a settings key, if it has one.
    pub fn default_for(&self, section: &str, key: &str) -> Option<&str> {
        let name = format!("{section}.{key}");
        self.defaults
            .iter()
            .rev()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// Reads `misty.conf`'s text. Malformed lines are errors, so a typo never goes unnoticed.
pub fn parse(text: &str) -> Result<Conf, String> {
    let mut conf = Conf::default();
    let mut section = String::new();
    for (index, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or_default().trim();
        if line.is_empty() {
            continue;
        }
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            section = name.trim().to_owned();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            return Err(format!(
                "misty.conf line {}: expected `key = value`",
                index + 1
            ));
        };
        let key = key.trim().to_owned();
        let value = unquote(value.trim()).to_owned();
        if key.is_empty() {
            return Err(format!("misty.conf line {}: the key is empty", index + 1));
        }
        match section.as_str() {
            "metadata" if key == "misty.manifest" => conf.manifest = Some(value),
            "metadata" if key == "misty.root" => conf.root = Some(value),
            "defaults" => conf.defaults.push((key, value)),
            name if OVERRIDE_SECTIONS.contains(&name) => {
                if looks_secret(&key) {
                    return Err(format!(
                        "misty.conf line {}: {key} looks like a secret; keep it in .env, not misty.conf",
                        index + 1
                    ));
                }
                match conf
                    .overrides
                    .iter_mut()
                    .find(|(section, _)| section == name)
                {
                    Some((_, entries)) => entries.push((key, value)),
                    None => conf.overrides.push((name.to_owned(), vec![(key, value)])),
                }
            }
            _ => {}
        }
    }
    Ok(conf)
}

fn unquote(value: &str) -> &str {
    for quote in ['"', '\''] {
        if let Some(inner) = value
            .strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote))
        {
            return inner;
        }
    }
    value
}

/// `misty.conf`'s text for `conf`.
pub fn render(conf: &Conf) -> String {
    let mut text = String::from(
        "# Which data folder Misty opens, and the defaults new settings start from.\n\
         # misty.root is always a folder in ~/.misty/dev or ~/.misty/rel.\n\n[metadata]\n",
    );
    if let Some(manifest) = &conf.manifest {
        text.push_str(&format!("misty.manifest = {manifest}\n"));
    }
    if let Some(root) = &conf.root {
        text.push_str(&format!("misty.root = {root}\n"));
    }
    text.push_str("\n[defaults]\n");
    for (key, value) in &conf.defaults {
        text.push_str(&format!("{key} = {value}\n"));
    }
    for (section, entries) in &conf.overrides {
        text.push_str(&format!("\n[{section}]\n"));
        for (key, value) in entries {
            text.push_str(&format!("{key} = {value}\n"));
        }
    }
    text
}

/// Where `misty.conf` is: `~/.misty/misty.conf`, whatever folder it names.
pub fn path(misty_root: &Path) -> PathBuf {
    misty_root.join(FILE_NAME)
}

/// `misty.conf` under `misty_root`; `None` when there is none yet.
pub fn read(misty_root: &Path) -> Result<Option<Conf>, String> {
    let file = path(misty_root);
    if !crate::fs::exists(&file) {
        return Ok(None);
    }
    let text = crate::fs::read_to_string(&file)
        .map_err(|error| format!("Misty couldn't read {}: {error}", file.display()))?;
    parse(&text).map(Some)
}

/// Writes `misty.conf` naming `folder` (relative to `~/.misty`, such as `rel/0.2.0`) as the data
/// folder, keeping its `[defaults]`. It goes through a temporary file, so it is never half-written.
pub fn write_root(misty_root: &Path, folder: &Path) -> std::io::Result<()> {
    let mut conf = read(misty_root).ok().flatten().unwrap_or_default();
    conf.manifest = Some(MANIFEST.to_owned());
    conf.root = Some(format!("~/.misty/{}", folder.to_string_lossy()));
    let file = path(misty_root);
    let staging = misty_root.join(format!(".{FILE_NAME}.writing"));
    crate::fs::write(&staging, render(&conf))?;
    crate::fs::rename(&staging, &file)
}

/// The data folder `misty.root` names, relative to `~/.misty` (`dev/default`, `rel/0.2.0`), once
/// it is checked to be one: `~/.misty/dev/<kind>` or `~/.misty/rel/<version>` exactly, no `..`, and
/// no link on the way, so `misty.conf` can never point Misty's data somewhere else.
pub fn folder_of(root: &str, misty_root: &Path) -> Result<PathBuf, String> {
    let refuse = || {
        format!(
            "misty.conf: misty.root must be a folder in ~/.misty/dev or ~/.misty/rel, not {root}"
        )
    };
    let home = misty_root.parent().ok_or_else(refuse)?;
    let full = match root.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(root),
    };
    let rest = full.strip_prefix(misty_root).map_err(|_| refuse())?;
    let parts: Vec<&str> = rest
        .components()
        .map(|part| match part {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect::<Option<_>>()
        .ok_or_else(refuse)?;
    let [kind, name] = parts.as_slice() else {
        return Err(refuse());
    };
    if ![paths::DEV_FOLDER, paths::RELEASE_FOLDER].contains(kind) || !paths::valid_name(name) {
        return Err(refuse());
    }
    for step in [misty_root.join(kind), full.clone()] {
        if crate::fs::symlink_metadata(&step).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err(refuse());
        }
    }
    Ok(Path::new(kind).join(name))
}

/// Sets each `[client]` name this process doesn't already have, before anything reads them. The
/// app calls it first thing, while it is still the only thread.
pub fn apply_client_defaults() {
    for (name, value) in current().overrides_for("client") {
        if OWN_NAMES.contains(&name.as_str()) || std::env::var_os(name).is_some() {
            continue;
        }
        // SAFETY: called at startup, before any other thread exists.
        unsafe { std::env::set_var(name, value) };
    }
}

/// This install's `misty.conf`, read once per process; an unreadable or missing one reads as empty.
pub fn current() -> &'static Conf {
    static CURRENT: OnceLock<Conf> = OnceLock::new();
    CURRENT.get_or_init(|| {
        paths::misty_root_dir()
            .and_then(|root| read(&root).ok().flatten())
            .unwrap_or_default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_metadata_and_defaults() {
        let conf = parse(
            "# mine\n[metadata]\nmisty.manifest = v1\nmisty.root = \"~/.misty/dev/bench\"\n\n\
             [defaults]\ngeneral.auto_update_enabled = false # off for benchmarks\n[later]\nx = 1\n\
             [server]\nport = 8081\n",
        )
        .unwrap();
        assert_eq!(conf.manifest.as_deref(), Some("v1"));
        assert_eq!(conf.root.as_deref(), Some("~/.misty/dev/bench"));
        assert_eq!(
            conf.default_for("general", "auto_update_enabled"),
            Some("false")
        );
        assert_eq!(conf.default_for("general", "launch_on_login"), None);
        assert_eq!(
            conf.overrides_for("server"),
            &[("port".to_owned(), "8081".to_owned())]
        );
        assert!(conf.overrides_for("cli").is_empty());
        assert!(parse("[server]\nGOOGLE_CLIENT_SECRET = x\n").is_err());
        assert!(parse("[cli]\nOPENAI_API_KEY = x\n").is_err());
        assert!(parse("[client]\nMISTY_AGENTS_ENV = 1\n").is_ok());
        assert!(parse("[metadata]\nmisty.root\n").is_err());
        assert_eq!(parse(&render(&conf)).unwrap(), conf);
    }

    #[test]
    fn the_root_must_be_a_dev_or_release_folder_in_misty() {
        let misty = Path::new("/home/me/.misty");
        assert_eq!(
            folder_of("~/.misty/dev/bench", misty).unwrap(),
            Path::new("dev/bench")
        );
        assert_eq!(
            folder_of("/home/me/.misty/rel/0.2.0", misty).unwrap(),
            Path::new("rel/0.2.0")
        );
        for outside in [
            "~/Documents/misty",
            "~/.misty",
            "~/.misty/dev",
            "~/.misty/shared/engines",
            "~/.misty/dev/../../x",
            "~/.misty/dev/a/b",
            "/tmp/.misty/dev/a",
        ] {
            assert!(folder_of(outside, misty).is_err(), "accepted {outside}");
        }
    }
}
