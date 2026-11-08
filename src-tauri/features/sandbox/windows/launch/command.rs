//! The command line and environment block a process starts with.
use super::*;

/// A command line for `arguments`, quoted the way programs built with the
/// Microsoft C runtime split it back (`CommandLineToArgvW`), so each argument
/// arrives whole whatever spaces, quotes or backslashes it holds.
pub fn command_line<I, S>(arguments: I) -> OsString
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut line: Vec<u16> = Vec::new();
    for (index, argument) in arguments.into_iter().enumerate() {
        if index > 0 {
            line.push(u16::from(b' '));
        }
        let units: Vec<u16> = argument.as_ref().encode_wide().collect();
        let plain = !units.is_empty()
            && !units
                .iter()
                .any(|&unit| matches!(unit, 0x20 | 0x09 | 0x0A | 0x0B | 0x22));
        if plain {
            line.extend(units);
            continue;
        }
        line.push(u16::from(b'"'));
        const BACKSLASH: u16 = b'\\' as u16;
        let mut backslashes = 0;
        for unit in units {
            if unit == BACKSLASH {
                backslashes += 1;
                continue;
            }
            // Backslashes double only before a quote, which is escaped.
            let repeat = if unit == u16::from(b'"') {
                backslashes * 2 + 1
            } else {
                backslashes
            };
            line.extend(std::iter::repeat_n(BACKSLASH, repeat));
            line.push(unit);
            backslashes = 0;
        }
        line.extend(std::iter::repeat_n(BACKSLASH, backslashes * 2));
        line.push(u16::from(b'"'));
    }
    std::os::windows::ffi::OsStringExt::from_wide(&line)
}

/// A Unicode environment block holding exactly `variables`, sorted by name
/// as Windows expects.
pub fn environment_block<I, K, V>(variables: I) -> Vec<u16>
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<OsStr>,
    V: AsRef<OsStr>,
{
    let mut entries: Vec<(OsString, OsString)> = variables
        .into_iter()
        .map(|(name, value)| (name.as_ref().to_owned(), value.as_ref().to_owned()))
        .filter(|(name, _)| !name.is_empty() && !name.to_string_lossy().contains('='))
        .collect();
    entries.sort_by_key(|(name, _)| name.to_string_lossy().to_uppercase());
    let mut block: Vec<u16> = Vec::new();
    for (name, value) in entries {
        block.extend(name.encode_wide());
        block.push(u16::from(b'='));
        block.extend(value.encode_wide().filter(|&unit| unit != 0));
        block.push(0);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    block
}
