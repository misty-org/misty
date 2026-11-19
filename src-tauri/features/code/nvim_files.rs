//! Reading the person's Neovim config files when Neovim isn't installed: the usual forms
//! (`vim.keymap.set`, `nvim_set_keymap`, `vim.opt`, `mapleader`, and Vimscript `map`/`set`), found
//! with patterns rather than run.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use super::{NvimConfig, NvimMapping, NvimOptions};

/// Enough for any hand-written config; a folder past this is mostly someone else's code.
const MOST_FILES: usize = 400;
const MOST_FILE_BYTES: u64 = 512 * 1024;

/// A Lua string literal in either quote, with its escapes.
const LUA_STRING: &str = r#"(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')"#;

static KEYMAP_SET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r#"vim\.keymap\.set\(\s*(\{{[^}}]*\}}|{s})\s*,\s*({s})\s*,\s*({s}|[^,)]+)\s*(?:,\s*(\{{[^}}]*\}}))?"#,
        s = LUA_STRING
    ))
    .expect("keymap pattern")
});
static SET_KEYMAP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r#"vim\.api\.nvim_set_keymap\(\s*({s})\s*,\s*({s})\s*,\s*({s})\s*(?:,\s*(\{{[^}}]*\}}))?"#,
        s = LUA_STRING
    ))
    .expect("set_keymap pattern")
});
static LUA_LEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(r#"vim\.g\.mapleader\s*=\s*({LUA_STRING})"#)).expect("leader pattern")
});
static LUA_OPTION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"vim\.(?:opt|o|wo|bo|go)\.(\w+)\s*=\s*(true|false|\d+)\b"#)
        .expect("option pattern")
});
static VIM_LEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*let\s+(?:g:)?mapleader\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')"#)
        .expect("vim leader pattern")
});
static VIM_MAP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*([nvxoi]?)(nore)?map(!?)\s+((?:<(?:silent|buffer|nowait|unique|expr)>\s*)*)(\S+)\s+(.+?)\s*$"#)
        .expect("vim map pattern")
});
/// `remap = true` in a `vim.keymap.set` options table; `\b` keeps `noremap` out.
static REMAP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bremap\s*=\s*true").expect("remap pattern"));
static NOREMAP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bnoremap\s*=\s*true").expect("noremap pattern"));
/// The options the editor follows, by their long and short names.
const KNOWN_OPTIONS: &[&str] = &[
    "tabstop",
    "ts",
    "shiftwidth",
    "sw",
    "expandtab",
    "et",
    "wrap",
    "number",
    "nu",
    "relativenumber",
    "rnu",
    "ignorecase",
    "ic",
    "smartcase",
    "scs",
];
static VIM_SET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)^\s*set?\s+(.+)$"#).expect("vim set pattern"));

/// The config's own files, the Lua and Vimscript under the folder, plugin managers' folders left
/// out. Read with the file gate, which allowed the folder above.
fn config_files(folder: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![(folder.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = pending.pop() {
        let Ok(entries) = file_access::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            if file_access::fs::is_dir(&path) {
                // A plugin manager's checkout or packpath isn't the person's own config.
                if depth < 6 && !matches!(name.as_str(), "pack" | "plugged" | "lazy" | "site") {
                    pending.push((path, depth + 1));
                }
                continue;
            }
            let wanted = path
                .extension()
                .is_some_and(|ext| ext == "lua" || ext == "vim");
            let small =
                file_access::fs::metadata(&path).is_ok_and(|meta| meta.len() <= MOST_FILE_BYTES);
            if wanted && small {
                files.push(path);
                if files.len() >= MOST_FILES {
                    return files;
                }
            }
        }
    }
    files.sort();
    files
}

pub(super) fn read_files(folder: &Path) -> NvimConfig {
    let mut config = NvimConfig {
        source: "files".into(),
        folder: folder.to_string_lossy().into_owned(),
        leader: "\\".into(),
        ..NvimConfig::default()
    };
    let mut options = BTreeMap::<String, String>::new();
    let mut mappings = BTreeMap::<(String, String), NvimMapping>::new();
    for path in config_files(folder) {
        let Ok(text) = file_access::fs::read_to_string(&path) else {
            continue;
        };
        if path.extension().is_some_and(|ext| ext == "lua") {
            read_lua(&text, &mut config, &mut options, &mut mappings);
        } else {
            read_vimscript(&text, &mut config, &mut options, &mut mappings);
        }
    }
    config.mappings = mappings.into_values().collect();
    let number = |key: &str| options.get(key).and_then(|value| value.parse::<u32>().ok());
    let flag = |key: &str| options.get(key).map(|value| value == "true");
    config.options = NvimOptions {
        tabstop: number("tabstop").or(number("ts")),
        shiftwidth: number("shiftwidth").or(number("sw")),
        expandtab: flag("expandtab").or(flag("et")),
        wrap: flag("wrap"),
        number: flag("number").or(flag("nu")),
        relativenumber: flag("relativenumber").or(flag("rnu")),
        ignorecase: flag("ignorecase").or(flag("ic")),
        smartcase: flag("smartcase").or(flag("scs")),
    };
    config
}

/// The text of a Lua string literal, its common escapes undone.
fn lua_string(literal: &str) -> Option<String> {
    let literal = literal.trim();
    let quote = literal.chars().next()?;
    if !(quote == '"' || quote == '\'') || !literal.ends_with(quote) || literal.len() < 2 {
        return None;
    }
    let inner = &literal[1..literal.len() - 1];
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    Some(out)
}

/// The modes of a Lua `mode` argument: `"n"` or `{ "n", "v" }`. Visual covers both `v` and `x`.
fn lua_modes(arg: &str) -> Vec<String> {
    let mut modes = Vec::new();
    let mut push = |mode: &str| {
        for single in mode.chars() {
            let mode = match single {
                'v' | 'x' => "x",
                'n' => "n",
                'o' => "o",
                'i' => "i",
                _ => continue,
            };
            if !modes.iter().any(|known: &String| known == mode) {
                modes.push(mode.to_string());
            }
        }
    };
    if arg.trim_start().starts_with('{') {
        for found in Regex::new(LUA_STRING)
            .expect("string pattern")
            .find_iter(arg)
        {
            if let Some(mode) = lua_string(found.as_str()) {
                push(&mode);
            }
        }
    } else if let Some(mode) = lua_string(arg) {
        push(&mode);
    }
    modes
}

fn read_lua(
    text: &str,
    config: &mut NvimConfig,
    options: &mut BTreeMap<String, String>,
    mappings: &mut BTreeMap<(String, String), NvimMapping>,
) {
    let text = strip_lua_comments(text);
    if let Some(leader) = LUA_LEADER
        .captures_iter(&text)
        .last()
        .and_then(|caps| lua_string(&caps[1]))
    {
        config.leader = leader;
    }
    for caps in LUA_OPTION.captures_iter(&text) {
        options.insert(caps[1].to_string(), caps[2].to_string());
    }
    for caps in KEYMAP_SET.captures_iter(&text) {
        let (Some(lhs), modes) = (lua_string(&caps[2]), lua_modes(&caps[1])) else {
            continue;
        };
        let Some(rhs) = lua_string(&caps[3]) else {
            // A function, or a variable: nothing the editor can run.
            config.skipped += modes.len();
            continue;
        };
        let remap = caps
            .get(4)
            .is_some_and(|opts| REMAP.is_match(opts.as_str()));
        for mode in modes {
            add_mapping(mappings, &mode, &lhs, &rhs, !remap, &config.leader);
        }
    }
    for caps in SET_KEYMAP.captures_iter(&text) {
        let (Some(mode), Some(lhs), Some(rhs)) = (
            lua_string(&caps[1]),
            lua_string(&caps[2]),
            lua_string(&caps[3]),
        ) else {
            continue;
        };
        let noremap = caps
            .get(4)
            .is_some_and(|opts| NOREMAP.is_match(opts.as_str()));
        for mode in lua_modes(&format!("\"{mode}\"")) {
            add_mapping(mappings, &mode, &lhs, &rhs, noremap, &config.leader);
        }
    }
}

fn read_vimscript(
    text: &str,
    config: &mut NvimConfig,
    options: &mut BTreeMap<String, String>,
    mappings: &mut BTreeMap<(String, String), NvimMapping>,
) {
    if let Some(leader) = VIM_LEADER
        .captures_iter(text)
        .last()
        .map(|caps| caps[1][1..caps[1].len() - 1].to_string())
    {
        config.leader = leader;
    }
    for caps in VIM_SET.captures_iter(text) {
        for part in caps[1].split_whitespace() {
            if part.starts_with('"') {
                break;
            }
            if let Some((name, value)) = part.split_once('=') {
                options.insert(name.to_string(), value.to_string());
            } else if KNOWN_OPTIONS.contains(&part) {
                options.insert(part.to_string(), "true".into());
            } else if let Some(name) = part
                .strip_prefix("no")
                .filter(|name| KNOWN_OPTIONS.contains(name))
            {
                // `nowrap`, but not `number`, which only starts with "no".
                options.insert(name.to_string(), "false".into());
            }
        }
    }
    for caps in VIM_MAP.captures_iter(text) {
        if caps[4].contains("<expr>") {
            // An expression mapping evaluates Vimscript, which the editor can't.
            config.skipped += 1;
            continue;
        }
        let modes = match &caps[1] {
            "" if &caps[3] == "!" => vec!["i"],
            "" => vec!["n", "x", "o"],
            "v" | "x" => vec!["x"],
            other => vec![other],
        };
        for mode in modes {
            add_mapping(
                mappings,
                mode,
                &caps[5],
                &caps[6],
                caps.get(2).is_some(),
                &config.leader,
            );
        }
    }
}

/// Lua with its `--` comments gone, so a commented-out mapping isn't read. Strings are left
/// alone, since `--` inside one isn't a comment.
fn strip_lua_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let mut quote: Option<char> = None;
        let mut previous = '\0';
        let mut cut = line.len();
        for (index, c) in line.char_indices() {
            match quote {
                Some(open) if c == open && previous != '\\' => quote = None,
                Some(_) => {}
                None if c == '"' || c == '\'' => quote = Some(c),
                None if c == '-' && previous == '-' => {
                    cut = index - 1;
                    break;
                }
                None => {}
            }
            previous = c;
        }
        out.push_str(&line[..cut]);
        out.push('\n');
    }
    out
}

/// One mapping, with `<leader>` spelled out the way Neovim lists it, so both sources agree.
fn add_mapping(
    mappings: &mut BTreeMap<(String, String), NvimMapping>,
    mode: &str,
    lhs: &str,
    rhs: &str,
    noremap: bool,
    leader: &str,
) {
    let lhs = expand_leader(lhs, leader);
    let rhs = expand_leader(rhs, leader);
    if lhs.is_empty() || rhs.is_empty() {
        return;
    }
    mappings.insert(
        (mode.to_string(), lhs.clone()),
        NvimMapping {
            mode: mode.to_string(),
            lhs,
            rhs,
            noremap,
        },
    );
}

fn expand_leader(keys: &str, leader: &str) -> String {
    static LEADER: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)<leader>").expect("leader key pattern"));
    let spelled = match leader {
        " " => "<Space>".to_string(),
        other => other.to_string(),
    };
    LEADER.replace_all(keys, spelled.as_str()).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_lua_keymaps_and_options() {
        let mut config = NvimConfig {
            leader: "\\".into(),
            ..NvimConfig::default()
        };
        let mut options = BTreeMap::new();
        let mut mappings = BTreeMap::new();
        read_lua(
            r#"
vim.g.mapleader = " "
vim.opt.relativenumber = true
vim.opt.tabstop = 4
vim.keymap.set("n", "<leader>w", ":w<CR>", { desc = "save" })
vim.keymap.set({ "n", "v" }, "H", "^")
vim.keymap.set("n", "<leader>f", function() print("x") end)
-- vim.keymap.set("n", "gone", "x")
"#,
            &mut config,
            &mut options,
            &mut mappings,
        );
        assert_eq!(config.leader, " ");
        assert_eq!(
            options.get("relativenumber").map(String::as_str),
            Some("true")
        );
        assert_eq!(options.get("tabstop").map(String::as_str), Some("4"));
        let save = &mappings[&("n".to_string(), "<Space>w".to_string())];
        assert_eq!(save.rhs, ":w<CR>");
        assert!(save.noremap);
        assert!(mappings.contains_key(&("x".to_string(), "H".to_string())));
        assert!(!mappings.keys().any(|(_, lhs)| lhs == "gone"));
        assert_eq!(config.skipped, 1);
    }

    #[test]
    fn reads_vimscript_maps_and_sets() {
        let mut config = NvimConfig {
            leader: "\\".into(),
            ..NvimConfig::default()
        };
        let mut options = BTreeMap::new();
        let mut mappings = BTreeMap::new();
        read_vimscript(
            "let mapleader = \",\"\nset nowrap number shiftwidth=2\nnnoremap <leader>q :q<CR>\nimap jk <Esc>\n",
            &mut config,
            &mut options,
            &mut mappings,
        );
        assert_eq!(config.leader, ",");
        assert_eq!(options.get("wrap").map(String::as_str), Some("false"));
        assert_eq!(options.get("shiftwidth").map(String::as_str), Some("2"));
        assert_eq!(options.get("number").map(String::as_str), Some("true"));
        assert!(mappings[&("n".to_string(), ",q".to_string())].noremap);
        assert!(!mappings[&("i".to_string(), "jk".to_string())].noremap);
    }
}
