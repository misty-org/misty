// Hermes Agent's commands outside Misty's folder, which Remove deletes when they start Misty's
// checkout and leaves alone otherwise:
//
// - Shell wrappers an older install left in `~/.local/bin` (`exec <checkout>/.hermes/bin/hermes`).
//   Installs now give the script a home inside Misty's folder, so new ones land there.
// - The Windows launchers `install.ps1` puts in `%LOCALAPPDATA%\hermes\bin`, its data folder's
//   `bin`.
//
// A Windows launcher says which checkout it starts: Hermes writes the same Python script into each, whose
// first `sys.path.insert(0, '<checkout>')` names it (`hermes_cli/_launchers.py`,
// `_launcher_checkout`). In `hermes.exe` the script is the `__main__.py` distlib appends,
// uncompressed; in the `hermes.cmd` fallback it is base64 inside `exec(base64.b64decode('…'))`. A launcher
// that can't be read that way still goes when the install recorded it as one it created and it
// names no other checkout.

use std::path::{Path, PathBuf};

use base64::Engine as _;

use super::support;

/// The commands Hermes Agent's installer exposes beside its launcher.
const COMMANDS: [&str; 3] = ["hermes", "hermes-acp", "hermes-agent"];
/// The endings of the launcher files Hermes writes on Windows.
const ENDINGS: [&str; 2] = [".exe", ".cmd"];
/// Launchers are small; anything bigger isn't one.
const MAX_LAUNCHER_BYTES: u64 = 16 * 1024 * 1024;
/// Inside Misty's folder for Hermes: the launchers the install found missing and then created.
const RECORD: &str = "launchers-created.txt";
const MARKER: &str = "sys.path.insert(0, ";
/// How the `.cmd` fallback carries the script.
const CMD_PAYLOAD: &str = "exec(base64.b64decode('";

/// The folders Hermes Agent's installer puts its commands in: on Windows its data folder's `bin`
/// (`%LOCALAPPDATA%\hermes\bin`), elsewhere the ones an older install used.
pub(super) fn dirs() -> Vec<PathBuf> {
    if cfg!(windows) {
        return vec![support::hermes_home().join("bin")];
    }
    let home = support::home_dir();
    vec![
        home.join(".local").join("bin"),
        home.join(".hermes").join("bin"),
    ]
}

/// Every Windows launcher file Hermes could write in `dirs`.
fn candidates(dirs: &[PathBuf]) -> Vec<PathBuf> {
    dirs.iter()
        .flat_map(|dir| {
            COMMANDS.iter().flat_map(move |name| {
                ENDINGS
                    .iter()
                    .map(move |ending| dir.join(format!("{name}{ending}")))
            })
        })
        .collect()
}

/// The launchers that aren't there yet, taken before an install so it can tell what it created.
pub(super) fn absent(dirs: &[PathBuf]) -> Vec<PathBuf> {
    candidates(dirs)
        .into_iter()
        .filter(|path| !file_access::fs::exists(path))
        .collect()
}

/// Records, in Misty's folder for Hermes (`folder`), which of the `absent` launchers the install
/// created.
pub(super) fn record_created(folder: &Path, absent: &[PathBuf]) -> Result<(), String> {
    let created: Vec<String> = absent
        .iter()
        .filter(|path| file_access::fs::exists(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    if created.is_empty() {
        return Ok(());
    }
    let mut text = recorded(folder)
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    text.extend(created);
    text.sort();
    text.dedup();
    file_access::fs::write(folder.join(RECORD), text.join("\n") + "\n")
        .map_err(|error| error.to_string())
}

fn recorded(folder: &Path) -> Vec<PathBuf> {
    file_access::fs::read_to_string(folder.join(RECORD))
        .map(|text| {
            text.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

/// Deletes the wrappers and launchers in `dirs` that start `checkout`, and the launchers the
/// install recorded in `folder` that name no other checkout.
pub(super) fn remove_owned(dirs: &[PathBuf], checkout: &Path, folder: &Path) {
    remove_wrappers(dirs, checkout);
    let recorded = recorded(folder);
    for launcher in candidates(dirs) {
        let owned = match read_checkout(&launcher) {
            Some(named) => same_path(&named, checkout),
            None => recorded.contains(&launcher),
        };
        if owned && file_access::fs::is_file(&launcher) {
            let _ = file_access::fs::remove_file(&launcher);
        }
    }
}

/// Whether the small wrapper script at `path` names `folder`. Only a file of a few KB is read: a
/// program folder outside the file gate, read for the one path it starts.
#[allow(clippy::disallowed_methods)]
pub(super) fn wrapper_names(path: &Path, folder: &Path) -> bool {
    let small = std::fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.len() <= 8192);
    if !small {
        return false;
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    let named = |folder: &Path| {
        let folder = folder.to_string_lossy();
        !folder.is_empty() && text.contains(&*folder)
    };
    let real = super::resolve_link(&folder.to_string_lossy()).unwrap_or_else(|_| folder.into());
    named(folder) || named(&real)
}

/// Deletes the shell wrappers left for `checkout`, and only those: one that names another
/// checkout is someone else's. They sit in a program folder outside the file gate.
#[allow(clippy::disallowed_methods)]
fn remove_wrappers(dirs: &[PathBuf], checkout: &Path) {
    for dir in dirs {
        for name in COMMANDS {
            let wrapper = dir.join(name);
            if wrapper_names(&wrapper, checkout) {
                let _ = std::fs::remove_file(&wrapper);
            }
        }
    }
}

/// Whether the Windows launcher at `path` starts `checkout`.
pub(super) fn starts_checkout(path: &Path, checkout: &Path) -> bool {
    read_checkout(path).is_some_and(|named| same_path(&named, checkout))
}

fn read_checkout(path: &Path) -> Option<String> {
    let meta = file_access::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_LAUNCHER_BYTES {
        return None;
    }
    launcher_checkout(&file_access::fs::read(path).ok()?)
}

/// The checkout a launcher's bytes start: from the base64 script of a `.cmd`, else from the
/// script stored as is in an `.exe`.
pub(super) fn launcher_checkout(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    if let Some(start) = text.find(CMD_PAYLOAD) {
        let rest = &text[start + CMD_PAYLOAD.len()..];
        let encoded = &rest[..rest.find('\'')?];
        let script = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .ok()?;
        return script_checkout(&String::from_utf8(script).ok()?);
    }
    script_checkout(&text)
}

/// The path in the script's first `sys.path.insert(0, <literal>)`.
fn script_checkout(script: &str) -> Option<String> {
    let start = script.find(MARKER)? + MARKER.len();
    python_string(&script[start..])
}

/// A Python string literal at the start of `text`, as `repr()` writes one: in single or double
/// quotes, with backslash escapes.
fn python_string(text: &str) -> Option<String> {
    let mut chars = text.chars();
    let quote = chars.next().filter(|c| *c == '\'' || *c == '"')?;
    let mut out = String::new();
    while let Some(c) = chars.next() {
        match c {
            '\\' => match chars.next()? {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                'x' => out.push(hex_char(&mut chars, 2)?),
                'u' => out.push(hex_char(&mut chars, 4)?),
                'U' => out.push(hex_char(&mut chars, 8)?),
                other => out.push(other),
            },
            '\n' => return None,
            c if c == quote => return Some(out),
            c => out.push(c),
        }
    }
    None
}

fn hex_char(chars: &mut std::str::Chars, digits: usize) -> Option<char> {
    let hex: String = chars.by_ref().take(digits).collect();
    (hex.len() == digits)
        .then(|| u32::from_str_radix(&hex, 16).ok())
        .flatten()
        .and_then(char::from_u32)
}

/// Whether `named` (as Hermes wrote it) is `checkout`, or the real folder `checkout` leads to.
/// Windows paths compare without regard to case or slash direction.
fn same_path(named: &str, checkout: &Path) -> bool {
    let norm = |path: &str| {
        let path = path
            .strip_prefix(r"\\?\")
            .unwrap_or(path)
            .replace('\\', "/");
        let path = path.trim_end_matches('/').to_string();
        if cfg!(windows) {
            path.to_lowercase()
        } else {
            path
        }
    };
    let named = norm(named);
    let real = file_access::fs::canonicalize(checkout).unwrap_or_else(|_| checkout.to_path_buf());
    [checkout, real.as_path()]
        .iter()
        .any(|path| norm(&path.to_string_lossy()) == named)
}
