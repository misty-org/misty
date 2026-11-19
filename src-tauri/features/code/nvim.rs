//! The person's own Neovim mappings and options, for the code editor's vim mode. Only what they
//! wrote themselves comes across: mappings defined in files under their Neovim config folder whose
//! right-hand side is keys or an Ex command, never a Lua function, and never a plugin's.
//!
//! With `nvim` installed, Neovim itself is asked: it loads the config as it always does (Lua,
//! `require`s and all), lists every mapping with the script that made it, and Misty keeps the ones
//! from the config folder. Without it, the config's files are read for the usual forms
//! (`vim.keymap.set`, `nvim_set_keymap`, `vim.opt`, `mapleader`, and Vimscript `map`/`set`).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

#[path = "nvim_files.rs"]
mod files;

use files::read_files;

/// How long a Neovim with a slow config may take before the files are read instead.
const NVIM_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NvimMapping {
    /// `n`, `x` (visual), `o` (operator-pending) or `i`.
    pub mode: String,
    pub lhs: String,
    pub rhs: String,
    pub noremap: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NvimOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tabstop: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shiftwidth: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expandtab: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relativenumber: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignorecase: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smartcase: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NvimConfig {
    /// `nvim` when Neovim was asked, `files` when the config was read, `none` when there is none.
    pub source: String,
    /// The config folder that was read, for the settings row.
    pub folder: String,
    /// The leader key as Neovim stores it (a single character, `\` by default).
    pub leader: String,
    pub mappings: Vec<NvimMapping>,
    pub options: NvimOptions,
    /// The person's own mappings that call Lua functions, which the editor can't run.
    pub skipped: usize,
}

/// Where Neovim reads its config: `$XDG_CONFIG_HOME/nvim` or `~/.config/nvim`, and
/// `%LOCALAPPDATA%\nvim` on Windows.
fn config_folder() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(xdg).join("nvim"));
    }
    #[cfg(windows)]
    {
        if let Some(local) = dirs::data_local_dir() {
            return Some(local.join("nvim"));
        }
    }
    dirs::home_dir().map(|home| home.join(".config").join("nvim"))
}

/// The person's Neovim mappings and options, read with Neovim when it is installed.
#[tauri::command]
pub async fn code_nvim_config(webview: tauri::Webview) -> Result<NvimConfig, String> {
    crate::project::person_window(&webview)?;
    let Some(folder) = config_folder() else {
        return Ok(none(""));
    };
    file_access::allow_editor_config_folder(&folder);
    if !file_access::fs::is_dir(&folder) {
        return Ok(none(&folder.to_string_lossy()));
    }
    if let Ok(nvim) = which::which("nvim") {
        if let Ok(config) = ask_nvim(&nvim, &folder).await {
            return Ok(config);
        }
    }
    let read = folder.clone();
    tokio::task::spawn_blocking(move || read_files(&read))
        .await
        .map_err(|_| "Couldn't read your Neovim config.".to_string())
}

fn none(folder: &str) -> NvimConfig {
    NvimConfig {
        source: "none".into(),
        folder: folder.into(),
        leader: "\\".into(),
        ..NvimConfig::default()
    }
}

/// The Lua Neovim runs after loading the config. `verbose` is on from the start (`--cmd`), so each
/// mapping made from Lua remembers its file; `getscriptinfo` turns that into a path.
const LIST_MAPPINGS: &str = r#"
local out = os.getenv("MISTY_NVIM_OUT")
local cfg = vim.fn.resolve(vim.fn.stdpath("config"))
if cfg:sub(-1) ~= "/" then cfg = cfg .. "/" end
local function own(sid)
  if type(sid) ~= "number" or sid <= 0 then return false end
  local ok, info = pcall(vim.fn.getscriptinfo, { sid = sid })
  if not ok or type(info) ~= "table" or not info[1] then return false end
  local name = vim.fn.resolve(vim.fn.fnamemodify(info[1].name, ":p"))
  return name:sub(1, #cfg) == cfg
end
local maps, seen, skipped = {}, {}, 0
for _, mode in ipairs({ "n", "x", "o", "i" }) do
  for _, m in ipairs(vim.api.nvim_get_keymap(mode)) do
    if own(m.sid) then
      local key = mode .. "\0" .. m.lhs
      if not seen[key] then
        seen[key] = true
        if type(m.rhs) == "string" and m.rhs ~= "" and m.callback == nil then
          table.insert(maps, { mode = mode, lhs = m.lhs, rhs = m.rhs, noremap = m.noremap == 1 })
        else
          skipped = skipped + 1
        end
      end
    end
  end
end
local o = vim.o
local data = {
  leader = vim.g.mapleader or "\\",
  mappings = maps,
  skipped = skipped,
  options = {
    tabstop = o.tabstop, shiftwidth = o.shiftwidth, expandtab = o.expandtab, wrap = o.wrap,
    number = o.number, relativenumber = o.relativenumber,
    ignorecase = o.ignorecase, smartcase = o.smartcase,
  },
}
local file = io.open(out, "w")
file:write(vim.json.encode(data))
file:close()
"#;

async fn ask_nvim(nvim: &Path, folder: &Path) -> Result<NvimConfig, String> {
    let scratch = std::env::temp_dir().join(format!("misty-nvim-{}", uuid::Uuid::new_v4()));
    file_access::fs::create_dir_all(&scratch).map_err(|error| error.to_string())?;
    let result = run_nvim(nvim, folder, &scratch).await;
    let _ = file_access::fs::remove_dir_all(&scratch);
    result
}

async fn run_nvim(nvim: &Path, folder: &Path, scratch: &Path) -> Result<NvimConfig, String> {
    let script = scratch.join("list.lua");
    let out = scratch.join("out.json");
    file_access::fs::write(&script, LIST_MAPPINGS).map_err(|error| error.to_string())?;
    let mut command = tokio::process::Command::new(nvim);
    command
        .args(["--headless", "-i", "NONE", "--cmd", "set verbose=1", "-c"])
        .arg(format!("luafile {}", vim_escape(&script.to_string_lossy())))
        .args(["-c", "qa!"])
        .env("MISTY_NVIM_OUT", &out)
        .current_dir(scratch)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let status = tokio::time::timeout(NVIM_TIMEOUT, command.status())
        .await
        .map_err(|_| "Neovim took too long to load its config.".to_string())?
        .map_err(|error| error.to_string())?;
    if !status.success() && !file_access::fs::is_file(&out) {
        return Err("Neovim couldn't load its config.".into());
    }
    let text = file_access::fs::read_to_string(&out).map_err(|error| error.to_string())?;
    let raw: serde_json::Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let mut config = NvimConfig {
        source: "nvim".into(),
        folder: folder.to_string_lossy().into_owned(),
        leader: raw["leader"].as_str().unwrap_or("\\").to_string(),
        skipped: raw["skipped"].as_u64().unwrap_or(0) as usize,
        ..NvimConfig::default()
    };
    // `vim.json.encode` writes an empty Lua table as `{}`, never `[]`.
    if let Some(list) = raw["mappings"].as_array() {
        for item in list {
            let (Some(mode), Some(lhs), Some(rhs)) = (
                item["mode"].as_str(),
                item["lhs"].as_str(),
                item["rhs"].as_str(),
            ) else {
                continue;
            };
            config.mappings.push(NvimMapping {
                mode: mode.into(),
                lhs: lhs.into(),
                rhs: rhs.into(),
                noremap: item["noremap"].as_bool().unwrap_or(true),
            });
        }
    }
    let options = &raw["options"];
    let number = |key: &str| options[key].as_u64().map(|value| value as u32);
    let flag = |key: &str| options[key].as_bool();
    config.options = NvimOptions {
        tabstop: number("tabstop"),
        shiftwidth: number("shiftwidth"),
        expandtab: flag("expandtab"),
        wrap: flag("wrap"),
        number: flag("number"),
        relativenumber: flag("relativenumber"),
        ignorecase: flag("ignorecase"),
        smartcase: flag("smartcase"),
    };
    Ok(config)
}

/// A path as one Ex argument: spaces and backslashes escaped.
fn vim_escape(path: &str) -> String {
    path.replace('\\', "\\\\").replace(' ', "\\ ")
}
