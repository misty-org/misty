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

#[cfg(windows)]
pub(super) struct Guard {
    entry: String,
    before: Option<Option<String>>,
}

#[cfg(windows)]
impl Guard {
    pub(super) fn take(entry: &std::path::Path) -> Self {
        Self {
            entry: entry.to_string_lossy().into_owned(),
            before: registry::read()
                .ok()
                .map(|value| value.map(|(text, _)| text)),
        }
    }

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
