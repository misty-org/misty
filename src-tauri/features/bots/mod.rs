// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Bot bundles: a long-lived assistant as a folder of plain files, so a person can read and edit
//! it with any editor and hand it to someone else.
//!
//!   bot.json    everything but the two prose fields
//!   SOUL.md     who the assistant is
//!   AGENTS.md   how it works
//!
//! In Misty a bundle is one of the person's own agents: importing one makes an agent (the renderer
//! saves it in misty.db with the person's other agents), and exporting writes an agent back out as a
//! bundle. The soul, the per-agent tool, skill and MCP lists and the runtime map onto the agent's
//! own fields. Memory stays Misty's: a bundle's memory settings are read and written so they
//! survive a round trip, but Misty's memory decides what is kept. Both dialogs run here, so a
//! window never names a path of its own.

use std::path::{Path, PathBuf};

use file_access::fs;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const SCHEMA_VERSION: u32 = 1;
const MAX_NAME_CHARS: usize = 64;
const MAX_TITLE_CHARS: usize = 48;
const MAX_DESCRIPTION_CHARS: usize = 200;
const MAX_PROSE_CHARS: usize = 100_000;
const SLUG_MAX_CHARS: usize = 48;

const SOUL_FILE: &str = "SOUL.md";
const INSTRUCTIONS_FILE: &str = "AGENTS.md";
const META_FILE: &str = "bot.json";

/// A bundle's avatar: a generated paper look (fold shape, expression and colour), an emoji, or an
/// image file inside the bundle.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotAvatar {
    /// "generated", "emoji" or "image".
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold_shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eyes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hue: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saturation: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lightness: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotCapabilities {
    /// Skill names enabled for this bot; `["*"]` means every skill.
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub mcp_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotRuntime {
    /// "direct" (Misty's own runtime) or an outside engine's id, such as "claude-code" or "codex".
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// "ask", "auto-safe" or "full".
    #[serde(default)]
    pub permission_mode: String,
}

impl Default for BotRuntime {
    fn default() -> Self {
        Self {
            kind: "direct".to_string(),
            model: None,
            cwd: None,
            extra_args: Vec::new(),
            permission_mode: "ask".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotMemoryConfig {
    pub enabled: bool,
    pub write_approval: bool,
    pub memory_char_limit: u32,
    pub review_enabled: bool,
    pub review_every_n_turns: u32,
}

impl Default for BotMemoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            write_approval: false,
            memory_char_limit: 2200,
            review_enabled: true,
            review_every_n_turns: 5,
        }
    }
}

/// `bot.json`: everything but the soul and the instructions, which have their own files.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BotMeta {
    #[serde(default)]
    id: String,
    #[serde(default)]
    slug: String,
    name: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    avatar: BotAvatar,
    #[serde(default)]
    capabilities: BotCapabilities,
    #[serde(default)]
    runtime: BotRuntime,
    #[serde(default)]
    memory: BotMemoryConfig,
    #[serde(default = "custom_source")]
    source: String,
    #[serde(default)]
    builtin_id: Option<String>,
    #[serde(default = "schema_version")]
    schema_version: u32,
    #[serde(default)]
    created_at: u64,
    #[serde(default)]
    updated_at: u64,
}

fn custom_source() -> String {
    "custom".to_string()
}

fn schema_version() -> u32 {
    SCHEMA_VERSION
}

/// A whole bundle, as the renderer maps it onto a Misty agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotBundle {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub avatar: BotAvatar,
    #[serde(default)]
    pub soul: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub capabilities: BotCapabilities,
    #[serde(default)]
    pub runtime: BotRuntime,
    #[serde(default)]
    pub memory: BotMemoryConfig,
    #[serde(default)]
    pub builtin_id: Option<String>,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

// ---- validation ----

fn validate_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err("A bot needs a name.".to_string());
    }
    if len > MAX_NAME_CHARS {
        return Err("A bot's name is 1 to 64 characters.".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_optional(
    value: Option<String>,
    max: usize,
    what: &str,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > max {
        return Err(format!("A bot's {what} is at most {max} characters."));
    }
    Ok(Some(trimmed))
}

fn validate_prose(value: String) -> Result<String, String> {
    if value.chars().count() > MAX_PROSE_CHARS {
        return Err("A bot's text is under 100,000 characters.".to_string());
    }
    Ok(value)
}

/// ASCII letters and digits are kept and everything else collapses to `-`. A name with no ASCII
/// at all falls back to a short suffix of the id, so the slug is always usable.
fn slug_base(name: &str, id: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        let suffix: String = id
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(6)
            .collect();
        return format!("bot-{}", if suffix.is_empty() { "new".into() } else { suffix });
    }
    out.chars().take(SLUG_MAX_CHARS).collect()
}

fn validate_slug(slug: &str) -> Result<String, String> {
    let trimmed = slug.trim().trim_start_matches('@').to_lowercase();
    if trimmed.is_empty() {
        return Err("A bot needs a slug.".to_string());
    }
    if trimmed.chars().count() > SLUG_MAX_CHARS {
        return Err("A bot's slug is at most 48 characters.".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("A bot's slug may only hold a-z, 0-9, '-' and '_'.".to_string());
    }
    Ok(trimmed)
}

/// The nine paper silhouettes and sixteen expressions. An unknown value is dropped rather than
/// refused: a bundle from a newer version falls back to the default look.
const FOLD_SHAPES: [&str; 9] = [
    "slender", "pocket", "petal", "flower", "star", "heart", "cloud", "diamond", "shield",
];
const EYES: [&str; 16] = [
    "neutral",
    "happy",
    "angry",
    "thinking",
    "shook",
    "curious",
    "wink",
    "sleepy",
    "sad",
    "worried",
    "skeptical",
    "focused",
    "excited",
    "calm",
    "shy",
    "confused",
];

fn known(value: &Option<String>, allowed: &[&str]) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| allowed.contains(value))
        .map(str::to_string)
}

fn clamp_range(value: Option<f64>, min: f64, max: f64) -> Option<f64> {
    value
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(min, max))
}

fn validate_avatar(avatar: &BotAvatar) -> BotAvatar {
    let mut out = avatar.clone();
    out.kind = match avatar.kind.as_str() {
        kind @ ("generated" | "emoji" | "image") => kind.to_string(),
        _ => "generated".to_string(),
    };
    out.value = out
        .value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    out.fold_shape = known(&out.fold_shape, &FOLD_SHAPES);
    out.eyes = known(&out.eyes, &EYES);
    out.hue = clamp_range(out.hue, 0.0, 360.0);
    out.saturation = clamp_range(out.saturation, 0.0, 100.0);
    out.lightness = clamp_range(out.lightness, 5.0, 95.0);
    // An image lives in the bundle, and Misty keeps agent avatars its own way; an emoji or image
    // with nothing to show falls back to the generated look.
    if out.kind == "image" || (out.kind == "emoji" && out.value.is_none()) {
        out.kind = "generated".to_string();
        out.value = None;
    }
    out
}

fn validate_runtime(runtime: &BotRuntime) -> Result<BotRuntime, String> {
    let kind = runtime.kind.trim();
    let kind = if kind.is_empty() { "direct" } else { kind };
    if kind.len() > 40
        || !kind
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Unknown runtime: {kind}"));
    }
    let permission = match runtime.permission_mode.as_str() {
        "" => "ask".to_string(),
        other @ ("ask" | "auto-safe" | "full") => other.to_string(),
        other => return Err(format!("Unknown permission mode: {other}")),
    };
    Ok(BotRuntime {
        kind: kind.to_string(),
        model: runtime
            .model
            .clone()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        cwd: runtime
            .cwd
            .clone()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        extra_args: runtime
            .extra_args
            .iter()
            .map(|arg| arg.trim().to_string())
            .filter(|arg| !arg.is_empty())
            .take(40)
            .collect(),
        permission_mode: permission,
    })
}

fn sanitize_capabilities(caps: &BotCapabilities) -> BotCapabilities {
    let clean = |values: &Vec<String>| -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for value in values {
            let trimmed = value.trim();
            if trimmed.is_empty() || trimmed.len() > 120 || out.iter().any(|v| v == trimmed) {
                continue;
            }
            out.push(trimmed.to_string());
        }
        out
    };
    BotCapabilities {
        skills: clean(&caps.skills),
        tools: clean(&caps.tools),
        mcp_servers: clean(&caps.mcp_servers),
    }
}

/// A bundle checked the way ccgui checks a bot before it is stored.
fn validated(bundle: BotBundle) -> Result<BotBundle, String> {
    let name = validate_name(&bundle.name)?;
    let slug = if bundle.slug.trim().is_empty() {
        slug_base(&name, &bundle.id)
    } else {
        validate_slug(&bundle.slug)?
    };
    Ok(BotBundle {
        id: bundle.id.trim().chars().take(80).collect(),
        slug,
        name,
        title: validate_optional(bundle.title, MAX_TITLE_CHARS, "title")?,
        description: validate_optional(bundle.description, MAX_DESCRIPTION_CHARS, "description")?,
        avatar: validate_avatar(&bundle.avatar),
        soul: validate_prose(bundle.soul)?,
        instructions: validate_prose(bundle.instructions)?,
        capabilities: sanitize_capabilities(&bundle.capabilities),
        runtime: validate_runtime(&bundle.runtime)?,
        memory: bundle.memory,
        builtin_id: bundle.builtin_id,
    })
}

// ---- files ----

fn read_text(path: &Path) -> Result<String, String> {
    if !fs::is_file(path) {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|error| format!("Couldn't read {}: {error}", file_name(path)))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Reads a bundle folder. Only its three files are opened, each allowed read-only because the
/// person picked the folder.
fn read_bundle(folder: &Path) -> Result<BotBundle, String> {
    let meta_path = folder.join(META_FILE);
    let soul_path = folder.join(SOUL_FILE);
    let instructions_path = folder.join(INSTRUCTIONS_FILE);
    for path in [&meta_path, &soul_path, &instructions_path] {
        file_access::allow_picked_file(path, file_access::Access::Read);
    }
    if !fs::is_file(&meta_path) {
        return Err(format!(
            "This folder isn't a bot: it has no {META_FILE}. A bot folder holds {META_FILE}, \
{SOUL_FILE} and {INSTRUCTIONS_FILE}."
        ));
    }
    let raw = read_text(&meta_path)?;
    let meta: BotMeta =
        serde_json::from_str(&raw).map_err(|error| format!("{META_FILE} isn't valid: {error}"))?;
    if meta.schema_version > SCHEMA_VERSION {
        return Err("This bot was made by a newer version and can't be read here.".to_string());
    }
    validated(BotBundle {
        id: meta.id,
        slug: meta.slug,
        name: meta.name,
        title: meta.title,
        description: meta.description,
        avatar: meta.avatar,
        soul: read_text(&soul_path)?,
        instructions: read_text(&instructions_path)?,
        capabilities: meta.capabilities,
        runtime: meta.runtime,
        memory: meta.memory,
        builtin_id: meta.builtin_id,
    })
}

/// Writes a bundle into `<parent>/<slug>/`. Each path is allowed for writing because the person
/// picked the parent folder; an existing bundle folder of that name is never overwritten.
fn write_bundle(parent: &Path, bundle: &BotBundle) -> Result<PathBuf, String> {
    let mut folder = parent.join(&bundle.slug);
    let mut attempt = 1;
    while fs::exists(&folder) {
        attempt += 1;
        if attempt > 50 {
            return Err("There are already too many bots of this name in that folder.".into());
        }
        folder = parent.join(format!("{}-{attempt}", bundle.slug));
    }
    let files = [
        folder.join(META_FILE),
        folder.join(SOUL_FILE),
        folder.join(INSTRUCTIONS_FILE),
    ];
    file_access::allow_picked_file(&folder, file_access::Access::Write);
    for file in &files {
        file_access::allow_picked_file(file, file_access::Access::Write);
    }
    fs::create_dir_all(&folder).map_err(|error| format!("Couldn't make the folder: {error}"))?;
    let now = now_millis();
    let meta = BotMeta {
        id: bundle.id.clone(),
        slug: bundle.slug.clone(),
        name: bundle.name.clone(),
        title: bundle.title.clone(),
        description: bundle.description.clone(),
        avatar: bundle.avatar.clone(),
        capabilities: bundle.capabilities.clone(),
        runtime: bundle.runtime.clone(),
        memory: bundle.memory.clone(),
        source: custom_source(),
        builtin_id: bundle.builtin_id.clone(),
        schema_version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
    };
    let meta =
        serde_json::to_string_pretty(&meta).map_err(|error| format!("Couldn't write the bot: {error}"))?;
    fs::write(&files[0], format!("{meta}\n"))
        .map_err(|error| format!("Couldn't write {META_FILE}: {error}"))?;
    // The prose files are always written, even empty: an empty SOUL.md reads as "nothing here yet"
    // to someone browsing the folder.
    fs::write(&files[1], &bundle.soul)
        .map_err(|error| format!("Couldn't write {SOUL_FILE}: {error}"))?;
    fs::write(&files[2], &bundle.instructions)
        .map_err(|error| format!("Couldn't write {INSTRUCTIONS_FILE}: {error}"))?;
    Ok(folder)
}

async fn pick_folder(app: &AppHandle, title: &str) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    folder
        .into_path()
        .map(Some)
        .map_err(|_| "Choose a folder on this computer.".to_string())
}

/// Reads the bot folder the person picks, for the renderer to make an agent from. `None` when
/// they cancel.
#[tauri::command]
pub async fn bot_bundle_import(app: AppHandle) -> Result<Option<BotBundle>, String> {
    let Some(folder) = pick_folder(&app, "Choose a bot folder").await? else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || read_bundle(&folder).map(Some))
        .await
        .map_err(|error| error.to_string())?
}

/// Writes an agent out as a bot folder inside the folder the person picks. Returns the folder's
/// name, or `None` when they cancel.
#[tauri::command]
pub async fn bot_bundle_export(
    app: AppHandle,
    bundle: BotBundle,
) -> Result<Option<String>, String> {
    let bundle = validated(bundle)?;
    let Some(parent) = pick_folder(&app, "Choose where to save the bot").await? else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || {
        write_bundle(&parent, &bundle).map(|folder| Some(file_name(&folder)))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle(name: &str) -> BotBundle {
        BotBundle {
            id: "personal_1234".into(),
            slug: String::new(),
            name: name.into(),
            title: None,
            description: Some("  ".into()),
            avatar: BotAvatar {
                kind: "emoji".into(),
                ..BotAvatar::default()
            },
            soul: "You are calm.".into(),
            instructions: "Work carefully.".into(),
            capabilities: BotCapabilities {
                skills: vec!["*".into(), "*".into()],
                tools: vec![" note.read ".into()],
                mcp_servers: vec![],
            },
            runtime: BotRuntime::default(),
            memory: BotMemoryConfig::default(),
            builtin_id: None,
        }
    }

    #[test]
    fn a_bundle_is_cleaned_the_way_a_bot_is_stored() {
        let clean = validated(bundle("Release Captain!")).unwrap();
        assert_eq!(clean.slug, "release-captain");
        assert_eq!(clean.description, None);
        assert_eq!(clean.avatar.kind, "generated");
        assert_eq!(clean.capabilities.skills, vec!["*"]);
        assert_eq!(clean.capabilities.tools, vec!["note.read"]);
        assert!(validated(bundle("")).is_err());
    }

    #[test]
    fn a_name_without_ascii_still_gets_a_slug() {
        assert_eq!(slug_base("机器人", "personal_ab12cd"), "bot-person");
        assert!(validate_slug("../escape").is_err());
    }

    #[test]
    fn a_bundle_round_trips_through_its_folder() {
        let parent = std::env::temp_dir().join(format!("misty-bots-{}", std::process::id()));
        let _ = fs::remove_dir_all(&parent);
        fs::create_dir_all(&parent).unwrap();
        let clean = validated(bundle("Scout")).unwrap();
        let folder = write_bundle(&parent, &clean).unwrap();
        let read = read_bundle(&folder).unwrap();
        assert_eq!(read.name, "Scout");
        assert_eq!(read.soul, "You are calm.");
        assert_eq!(read.instructions, "Work carefully.");
        // A second export of the same name never overwrites the first.
        let again = write_bundle(&parent, &clean).unwrap();
        assert_ne!(again, folder);
        let _ = fs::remove_dir_all(&parent);
    }
}
