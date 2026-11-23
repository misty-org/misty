use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use crate::paths;

pub const FILE_NAME: &str = "misty.conf";
pub const MANIFEST: &str = "v1";

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Conf {
    pub manifest: Option<String>,
    pub root: Option<String>,
    pub defaults: Vec<(String, String)>,
    pub overrides: Vec<(String, Vec<(String, String)>)>,
}

pub const OVERRIDE_SECTIONS: &[&str] = &["client", "server", "cli"];

const OWN_NAMES: &[&str] = &["MISTY_PROFILE", "MISTY_DATA_ROOT"];

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
    pub fn overrides_for(&self, section: &str) -> &[(String, String)] {
        self.overrides
            .iter()
            .find(|(name, _)| name == section)
            .map_or(&[], |(_, entries)| entries.as_slice())
    }

    pub fn default_for(&self, section: &str, key: &str) -> Option<&str> {
        let name = format!("{section}.{key}");
        self.defaults
            .iter()
            .rev()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.as_str())
    }
}

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

pub fn path(misty_root: &Path) -> PathBuf {
    misty_root.join(FILE_NAME)
}

pub fn read(misty_root: &Path) -> Result<Option<Conf>, String> {
    let file = path(misty_root);
    if !crate::fs::exists(&file) {
        return Ok(None);
    }
    let text = crate::fs::read_to_string(&file)
        .map_err(|error| format!("Misty couldn't read {}: {error}", file.display()))?;
    parse(&text).map(Some)
}

pub fn write_root(misty_root: &Path, folder: &Path) -> std::io::Result<()> {
    let mut conf = read(misty_root).ok().flatten().unwrap_or_default();
    conf.manifest = Some(MANIFEST.to_owned());
    conf.root = Some(format!("~/.misty/{}", folder.to_string_lossy()));
    let file = path(misty_root);
    let staging = misty_root.join(format!(".{FILE_NAME}.writing"));
    crate::fs::write(&staging, render(&conf))?;
    crate::fs::rename(&staging, &file)
}

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

pub fn apply_client_defaults() {
    for (name, value) in current().overrides_for("client") {
        if OWN_NAMES.contains(&name.as_str()) || std::env::var_os(name).is_some() {
            continue;
        }
        // SAFETY: called at startup, before any other thread exists.
        unsafe { std::env::set_var(name, value) };
    }
}

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
