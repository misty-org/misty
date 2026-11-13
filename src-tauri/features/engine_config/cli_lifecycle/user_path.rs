// Windows' user PATH around Hermes Agent's installer. `install.ps1` always puts its commands'
// folder (`%LOCALAPPDATA%\hermes\bin`, its data folder's `bin`) first on the user PATH
// (`HKCU\Environment\Path`), and nothing in the script skips that. Misty finds Hermes in its own
// folder and never needs that entry, so it reads the user PATH before the script runs and, when
// the script added the entry, takes out that entry and nothing else, keeping the value's kind
// (`REG_EXPAND_SZ` or `REG_SZ`) and every other entry as it was. Then it tells Windows the
// environment changed (`WM_SETTINGCHANGE` with "Environment"), as the script does after writing.
//
// The editing is [`without_added_entry`], a pure function on strings; the registry and the
// broadcast are Windows-only.

/// The user PATH `after` the installer ran, with `entry` taken out again, or `None` to leave it
/// alone: when `before` already named `entry`, or `after` doesn't. Entries compare the way
/// Windows resolves them: `%VAR%` expanded by `expand`, without regard to case, slash direction,
/// surrounding quotes or a trailing slash. Every other entry, empty ones and a trailing `;`
/// included, stays exactly as `after` has it.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn without_added_entry(
    before: Option<&str>,
    after: &str,
    entry: &str,
    expand: impl Fn(&str) -> String,
) -> Option<String> {
    let wanted = normalize(entry);
    if wanted.is_empty() {
        return None;
    }
    let is_entry = |segment: &str| normalize(&expand(segment)) == wanted;
    if before.is_some_and(|before| before.split(';').any(is_entry)) {
        return None;
    }
    let kept: Vec<&str> = after
        .split(';')
        .filter(|segment| !is_entry(segment))
        .collect();
    if kept.len() == after.split(';').count() {
        return None;
    }
    Some(kept.join(";"))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn normalize(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// The user PATH as it was before an install, to put right afterwards.
#[cfg(windows)]
pub(super) struct Guard {
    entry: String,
    /// `None` when the user PATH couldn't be read: then nothing is put right afterwards, since
    /// Misty can't tell whether the entry was there before.
    before: Option<Option<String>>,
}

#[cfg(windows)]
impl Guard {
    /// Reads the user PATH before the installer runs. `entry` is the folder the installer may add.
    pub(super) fn take(entry: &std::path::Path) -> Self {
        Self {
            entry: entry.to_string_lossy().into_owned(),
            before: registry::read()
                .ok()
                .map(|value| value.map(|(text, _)| text)),
        }
    }

    /// Takes out the entry the installer added, if it did, and tells Windows. A failure here only
    /// leaves the entry where the installer put it, so it is reported in the output, not as an
    /// install failure.
    pub(super) fn restore(self, reporter: &super::ProgressReporter) {
        let Some(before) = self.before else {
            return;
        };
        let Ok(Some((after, kind))) = registry::read() else {
            return;
        };
        let Some(fixed) = without_added_entry(before.as_deref(), &after, &self.entry, expand_env)
        else {
            return;
        };
        // No user PATH before and nothing left but separators: there was none, so there is none.
        let value = if before.is_none() && fixed.trim_matches(';').trim().is_empty() {
            None
        } else {
            Some((&fixed, kind))
        };
        match registry::write(value) {
            Ok(()) => {
                registry::broadcast();
                reporter.emit(
                    "stdout",
                    Some(format!("Took {} back off the user PATH.", self.entry)),
                    None,
                );
            }
            Err(error) => reporter.emit(
                "stderr",
                Some(format!(
                    "Couldn't take {} back off the user PATH: {error}",
                    self.entry
                )),
                None,
            ),
        }
    }
}

/// `%VAR%` expanded from Misty's own environment; an unknown one stays as written.
#[cfg(windows)]
fn expand_env(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => out.push_str(&rest[start..start + end + 2]),
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(windows)]
mod registry {
    use winreg::enums::{RegType, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
    use winreg::{RegKey, RegValue};

    fn key(flags: u32) -> std::io::Result<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Environment", flags)
    }

    /// The user PATH as written, unexpanded, with its kind; `None` when there is none. A value
    /// that isn't a string is an error: Misty doesn't edit what it can't read.
    pub(super) fn read() -> std::io::Result<Option<(String, RegType)>> {
        let missing = |error: &std::io::Error| error.kind() == std::io::ErrorKind::NotFound;
        let value = match key(KEY_QUERY_VALUE).and_then(|key| key.get_raw_value("Path")) {
            Ok(value) => value,
            Err(error) if missing(&error) => return Ok(None),
            Err(error) => return Err(error),
        };
        if !matches!(value.vtype, RegType::REG_SZ | RegType::REG_EXPAND_SZ) {
            return Err(std::io::Error::other("the user PATH isn't a string"));
        }
        let units: Vec<u16> = value
            .bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let end = units
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(units.len());
        let text = String::from_utf16(&units[..end]).map_err(std::io::Error::other)?;
        Ok(Some((text, value.vtype)))
    }

    /// Writes the user PATH back with the kind it had, or deletes it with `None`.
    pub(super) fn write(value: Option<(&String, RegType)>) -> std::io::Result<()> {
        let key = key(KEY_SET_VALUE)?;
        let Some((text, vtype)) = value else {
            return key.delete_value("Path");
        };
        let bytes = text
            .encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        key.set_raw_value("Path", &RegValue { bytes, vtype })
    }

    /// Tells running programs the environment changed, as Windows expects after an edit to
    /// `HKCU\Environment`: `WM_SETTINGCHANGE` to every top-level window, naming "Environment",
    /// without waiting on one that hangs.
    pub(super) fn broadcast() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        let area: Vec<u16> = "Environment".encode_utf16().chain(Some(0)).collect();
        let mut result = 0usize;
        // SAFETY: `area` is a NUL-terminated UTF-16 string that outlives the call, which copies
        // it for each window before returning (at most 5 seconds per window).
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                area.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                5000,
                &mut result,
            );
        }
    }
}
