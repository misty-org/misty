use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use space_drive::{names, Drive, Kind, NewNode, Node, SpaceId, Version};
use tauri::AppHandle;

use crate::agents::run_control::tool_policy::RunFacts;

pub(crate) mod index;
pub(crate) mod topics;

use topics::INDEX;

const READ_WAIT: Duration = Duration::from_secs(20);
const PROMPT_WAIT: Duration = Duration::from_secs(5);
const MOST_TOPIC_READ: u64 = 1024 * 1024;

pub(crate) const MEMORY_READ: &str = "memory_read";
pub(crate) const MEMORY_WRITE: &str = "memory_write";
pub(crate) const MEMORY_EDIT: &str = "memory_edit";
pub(crate) const MEMORY_FORGET: &str = "memory_forget";
pub(crate) const SPACE_CLAIMS: &str = "space_claims";

pub(crate) const WIRE_NAMES: [&str; 5] = [
    MEMORY_READ,
    MEMORY_WRITE,
    MEMORY_EDIT,
    MEMORY_FORGET,
    SPACE_CLAIMS,
];

const MEMORY_INSTRUCTIONS: &str = "This agent keeps its memory in its Space's drive, shared with \
everyone in that Space who uses the agent: MEMORY.md is its index, one line per topic, and each topic \
is a small Markdown file. Remember what will matter in later chats (decisions, preferences, facts \
about the work and the people) with memory_write, change a topic with memory_edit, drop what is wrong \
or stale with memory_forget, and read a topic in full with memory_read. Keep one topic per subject, \
update a topic rather than adding a near copy, and never put secrets, keys or passwords in memory.";

const CLAIMS_INSTRUCTIONS: &str =
    "space_claims lists the files other members' agents are changing \
in this Space right now; check it before changing files others may be working on.";

pub(crate) struct Place {
    pub(crate) space: String,
    pub(crate) agent: String,
    pub(crate) by: String,
    pub(crate) run: String,
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn place_in(run_id: &str, body: &Value) -> Option<Place> {
    let space = body["agent_memory"]["space_id"]
        .as_str()
        .filter(|id| safe_id(id))?;
    let agent = body["agent_id"].as_str().filter(|id| safe_id(id))?;
    let by = body["agent_memory"]["by"]
        .as_str()
        .map(|name| topics::one_line(name, 80))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Someone".into());
    Some(Place {
        space: space.to_string(),
        agent: agent.to_string(),
        by,
        run: run_id.to_string(),
    })
}

pub(crate) fn place_of(run_id: &str) -> Option<Place> {
    let body = super::runs::request_of(run_id)?;
    place_in(run_id, &body)
}

fn in_space(run_id: &str) -> bool {
    super::runs::request_of(run_id).is_some_and(|body| {
        body["engine"]["space"]
            .as_str()
            .is_some_and(|space| !space.is_empty())
    })
}

fn memory_folder(place: &Place) -> String {
    index::folder_of(&place.agent)
}

fn memory_dir(place: &Place) -> Option<PathBuf> {
    crate::spaces_drive::run_folder(&place.space)
        .map(|mount| names::local_path(&mount, &memory_folder(place)))
}

pub(crate) fn instructions(run_id: &str) -> Option<String> {
    let memory = place_of(run_id).map(|_| MEMORY_INSTRUCTIONS);
    let claims = in_space(run_id).then_some(CLAIMS_INSTRUCTIONS);
    let text: Vec<&str> = memory.into_iter().chain(claims).collect();
    (!text.is_empty()).then(|| text.join(" "))
}

pub(crate) fn internal_name(run_id: &str, wire: &str) -> Option<&'static str> {
    let internal = match wire {
        MEMORY_READ => "memory.read",
        MEMORY_WRITE => "memory.write",
        MEMORY_EDIT => "memory.edit",
        MEMORY_FORGET => "memory.forget",
        SPACE_CLAIMS => "space.claims",
        _ => return None,
    };
    let offered = if wire == SPACE_CLAIMS {
        in_space(run_id)
    } else {
        place_of(run_id).is_some()
    };
    offered.then_some(internal)
}

fn topic_schema(description: &str) -> Value {
    json!({ "type": "string", "minLength": 1, "maxLength": 200, "description": description })
}

pub(crate) fn offered(run_id: &str) -> Vec<Value> {
    let mut tools = Vec::new();
    if place_of(run_id).is_some() {
        tools.push(json!({
            "name": MEMORY_READ,
            "description": "Read this agent's memory: without a topic, MEMORY.md (the index, one line per topic) and the topic files; with one, that topic in full.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "topic": topic_schema("The topic's file name, such as \"deploy-notes.md\", or its title."),
                },
            },
            "annotations": { "readOnlyHint": true },
        }));
        tools.push(json!({
            "name": MEMORY_WRITE,
            "description": "Save a topic to this agent's memory, shared with everyone in its Space who uses the agent. A title that is already a topic replaces it. Keeps MEMORY.md's line for the topic current.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["title", "body"],
                "properties": {
                    "title": { "type": "string", "minLength": 1, "maxLength": 120, "description": "A short title; the file is named after it." },
                    "body": { "type": "string", "minLength": 1, "maxLength": 60000, "description": "The topic in Markdown." },
                    "hook": { "type": "string", "maxLength": 200, "description": "One line for MEMORY.md saying what the topic holds. Taken from the body when left out." },
                    "tags": {
                        "type": "array",
                        "maxItems": 10,
                        "items": { "type": "string", "minLength": 1, "maxLength": 40 },
                    },
                },
            },
        }));
        tools.push(json!({
            "name": MEMORY_EDIT,
            "description": "Change a topic in this agent's memory: replace one passage (find, which must appear exactly once, and replace) or the whole body. hook changes its line in MEMORY.md.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["topic"],
                "properties": {
                    "topic": topic_schema("The topic's file name or title."),
                    "find": { "type": "string", "minLength": 1, "maxLength": 20000 },
                    "replace": { "type": "string", "maxLength": 60000 },
                    "body": { "type": "string", "minLength": 1, "maxLength": 60000, "description": "The topic's whole new body, in place of find and replace." },
                    "hook": { "type": "string", "maxLength": 200 },
                },
            },
        }));
        tools.push(json!({
            "name": MEMORY_FORGET,
            "description": "Forget a topic: its file leaves this agent's memory (to the Space's .trash, where the person can bring it back) and its line leaves MEMORY.md.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["topic"],
                "properties": { "topic": topic_schema("The topic's file name or title.") },
            },
        }));
    }
    if in_space(run_id) {
        tools.push(json!({
            "name": SPACE_CLAIMS,
            "description": "List the files other members' agents in this Space are changing right now, with whose agent it is and what it is doing. Paths are relative to each agent's own folder.",
            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {} },
            "annotations": { "readOnlyHint": true },
        }));
    }
    tools
}

fn drive_text(error: space_drive::DriveError) -> String {
    crate::spaces_drive::error_text(error)
}

fn file_path(place: &Place, file: &str) -> String {
    names::join(&memory_folder(place), file)
}

fn node(drive: &Drive, space: &SpaceId, path: &str) -> Result<Option<Node>, String> {
    match drive.node_at(space, path) {
        Ok(Some(node)) if node.kind == Kind::File => Ok(Some(node)),
        Ok(Some(_)) => Err(format!("{path} is a folder, not a topic.")),
        Ok(None) => Ok(None),
        Err(error) => Err(drive_text(error)),
    }
}

async fn read_text(
    drive: &Drive,
    space: &SpaceId,
    path: &str,
    wait: Duration,
) -> Result<Option<(String, Node)>, String> {
    let Some(found) = node(drive, space, path)? else {
        return Ok(None);
    };
    let bytes = tokio::time::timeout(wait, drive.read_capped(space, path, MOST_TOPIC_READ))
        .await
        .map_err(|_| {
            format!("Misty couldn't fetch {path} from the Space in time. Try again in a moment.")
        })?
        .map_err(drive_text)?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{path} isn't text."))?;
    Ok(Some((text, found)))
}

async fn read_index(
    drive: &Drive,
    space: &SpaceId,
    place: &Place,
) -> Result<(String, Option<Node>), String> {
    Ok(
        match read_text(drive, space, &file_path(place, INDEX), READ_WAIT).await? {
            Some((text, found)) => (text, Some(found)),
            None => (String::new(), None),
        },
    )
}

struct Save {
    name: String,
    text: String,
    replace: Option<Node>,
}

async fn save_all(
    drive: &Drive,
    space: &SpaceId,
    folder: String,
    saves: Vec<Save>,
) -> Result<(), String> {
    let (drive, space) = (drive.clone(), space.clone());
    tokio::task::spawn_blocking(move || {
        for save in saves {
            let replace = save
                .replace
                .map(|found| (found.id, found.version.unwrap_or(Version(0))));
            drive
                .write_bytes(&space, &folder, &save.name, save.text.as_bytes(), replace)
                .map_err(drive_text)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn signed(place: &Place) -> String {
    format!("{}, run {}", place.by, place.run)
}

fn text_arg<'a>(input: &'a Value, name: &str) -> Option<&'a str> {
    input[name].as_str()
}

fn tags_arg(input: &Value) -> Vec<String> {
    input["tags"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|tag| topics::one_line(tag, 40))
        .filter(|tag| !tag.is_empty())
        .take(10)
        .collect()
}

fn refused(code: &str, message: impl Into<String>) -> (String, String) {
    (code.to_string(), message.into())
}

pub(crate) async fn call(
    app: &AppHandle,
    facts: &RunFacts,
    name: &str,
    input: Value,
) -> Result<Value, (String, String)> {
    let Some(place) = place_of(&facts.run_id) else {
        return Err(refused(
            "memory_unavailable",
            "This run keeps no agent memory: only an agent's own chats in a Space do.",
        ));
    };
    let drive =
        crate::spaces_drive::drive().map_err(|message| refused("drive_unavailable", message))?;
    let space = SpaceId(place.space.clone());
    let done = match name {
        "memory.read" => read(&drive, &space, &place, &input).await,
        "memory.write" => write(&drive, &space, &place, &input).await,
        "memory.edit" => edit(&drive, &space, &place, &input).await,
        "memory.forget" => {
            forget(
                &drive,
                &space,
                &place,
                text_arg(&input, "topic").unwrap_or(""),
            )
            .await
        }
        _ => Err(format!("There is no tool named {name}.")),
    };
    if name != "memory.read" && done.is_ok() {
        index::refresh_soon(app, &place.space, &place.agent);
    }
    done.map_err(|message| refused("memory_refused", message))
}

async fn read(
    drive: &Drive,
    space: &SpaceId,
    place: &Place,
    input: &Value,
) -> Result<Value, String> {
    let (index_text, _) = read_index(drive, space, place).await?;
    let topic = text_arg(input, "topic").unwrap_or("").trim();
    if topic.is_empty() {
        let files: Vec<String> = match drive.entries(space, &memory_folder(place), None, Some(500))
        {
            Ok(page) => page
                .entries
                .into_iter()
                .filter(|entry| entry.kind == Kind::File && topics::good_file(&entry.name))
                .map(|entry| entry.name)
                .collect(),
            Err(space_drive::DriveError::NotFound) => Vec::new(),
            Err(error) => return Err(drive_text(error)),
        };
        let shown = if index_text.trim().is_empty() {
            "This agent has no memory yet.".to_string()
        } else {
            index_text
        };
        return Ok(json!({ "index": shown, "topics": files }));
    }
    let file = topics::topic_file(topic, &index_text)?;
    match read_text(drive, space, &file_path(place, &file), READ_WAIT).await? {
        Some((text, _)) => Ok(json!({ "topic": file, "text": text })),
        None => Err(format!(
            "There's no topic {file} in this agent's memory. memory_read without a topic lists them."
        )),
    }
}

async fn write(
    drive: &Drive,
    space: &SpaceId,
    place: &Place,
    input: &Value,
) -> Result<Value, String> {
    let title = topics::one_line(text_arg(input, "title").unwrap_or(""), 120);
    let body = text_arg(input, "body").unwrap_or("").trim().to_string();
    if title.is_empty() || body.is_empty() {
        return Err("memory_write needs a title and a body. Nothing was saved.".into());
    }
    let (index_text, index_node) = read_index(drive, space, place).await?;
    let file = topics::topic_file(&title, &index_text)?;
    let text = topics::written(&title, &now(), &signed(place), &tags_arg(input), &body);
    topics::topic_fits(&text)?;
    let hook = text_arg(input, "hook")
        .map(|hook| topics::one_line(hook, 150))
        .filter(|hook| !hook.is_empty())
        .unwrap_or_else(|| topics::hook_of(&body));
    let next_index = topics::with_line(
        &index_text,
        &file,
        &topics::index_line(&title, &file, &hook),
    );
    topics::index_fits(&next_index)?;
    let existing = node(drive, space, &file_path(place, &file))?;
    let replaced = existing.is_some();
    let mut saves = vec![Save {
        name: file.clone(),
        text,
        replace: existing,
    }];
    if next_index != index_text {
        saves.push(Save {
            name: INDEX.into(),
            text: next_index,
            replace: index_node,
        });
    }
    save_all(drive, space, memory_folder(place), saves).await?;
    Ok(json!({
        "ok": true,
        "topic": file,
        "replaced": replaced,
        "path": format!(".agents/{}/memory/{file}", place.agent),
    }))
}

async fn edit(
    drive: &Drive,
    space: &SpaceId,
    place: &Place,
    input: &Value,
) -> Result<Value, String> {
    let (index_text, index_node) = read_index(drive, space, place).await?;
    let file = topics::topic_file(text_arg(input, "topic").unwrap_or(""), &index_text)?;
    let Some((text, found)) = read_text(drive, space, &file_path(place, &file), READ_WAIT).await?
    else {
        return Err(format!(
            "There's no topic {file} in this agent's memory. memory_write makes a new one."
        ));
    };
    let topic = topics::split(&text);
    let body = match (text_arg(input, "body"), text_arg(input, "find")) {
        (Some(_), Some(_)) => {
            return Err(
                "Give either body or find and replace, not both. Nothing was changed.".into(),
            )
        }
        (Some(body), None) => body.trim().to_string(),
        (None, Some(find)) => {
            let replace = text_arg(input, "replace").unwrap_or("");
            match topic.body.matches(find).count() {
                0 => {
                    return Err(format!(
                        "{file} doesn't contain that passage. Read it with memory_read first. Nothing was changed."
                    ))
                }
                1 => topic.body.replacen(find, replace, 1),
                many => {
                    return Err(format!(
                        "That passage appears {many} times in {file}; give more of it so it appears once. Nothing was changed."
                    ))
                }
            }
        }
        (None, None) => {
            if text_arg(input, "hook").is_none() {
                return Err(
                    "Say what to change: find and replace, body, or hook. Nothing was changed."
                        .into(),
                );
            }
            topic.body.clone()
        }
    };
    if body.trim().is_empty() {
        return Err(
            "A topic can't be empty; forget it with memory_forget instead. Nothing was changed."
                .into(),
        );
    }
    let next = topics::restamped(&topic, &file, &now(), &signed(place), &body);
    topics::topic_fits(&next)?;
    let mut saves = Vec::new();
    if let Some(hook) = text_arg(input, "hook") {
        let title = topics::title_of(&topics::split(&next).front, &file);
        let next_index =
            topics::with_line(&index_text, &file, &topics::index_line(&title, &file, hook));
        topics::index_fits(&next_index)?;
        if next_index != index_text {
            saves.push(Save {
                name: INDEX.into(),
                text: next_index,
                replace: index_node,
            });
        }
    }
    saves.insert(
        0,
        Save {
            name: file.clone(),
            text: next,
            replace: Some(found),
        },
    );
    save_all(drive, space, memory_folder(place), saves).await?;
    Ok(json!({ "ok": true, "topic": file }))
}

async fn forget(
    drive: &Drive,
    space: &SpaceId,
    place: &Place,
    topic: &str,
) -> Result<Value, String> {
    let (index_text, index_node) = read_index(drive, space, place).await?;
    let file = topics::topic_file(topic, &index_text)?;
    let found = node(drive, space, &file_path(place, &file))?;
    let listed = topics::listed(&index_text, &file);
    if found.is_none() && !listed {
        return Err(format!("There's no topic {file} in this agent's memory."));
    }
    if let Some(found) = found {
        let (drive, space) = (drive.clone(), space.clone());
        tokio::task::spawn_blocking(move || drive.trash(&space, &found.id).map_err(drive_text))
            .await
            .map_err(|error| error.to_string())??;
    }
    if listed {
        let next_index = topics::without_line(&index_text, &file);
        save_all(
            drive,
            space,
            memory_folder(place),
            vec![Save {
                name: INDEX.into(),
                text: next_index,
                replace: index_node,
            }],
        )
        .await?;
    }
    Ok(json!({ "ok": true, "forgot": file }))
}

pub(crate) async fn forget_from_view(
    store: &database::store::Store,
    space: &str,
    agent: &str,
    note_id: &str,
) -> Result<(), String> {
    let file = note_id
        .strip_prefix(index::NOTE_PREFIX)
        .filter(|file| topics::good_file(file))
        .ok_or_else(|| "This memory note is no longer available.".to_string())?;
    if !safe_id(space) || !safe_id(agent) {
        return Err("This memory note is no longer available.".into());
    }
    let place = Place {
        space: space.to_string(),
        agent: agent.to_string(),
        by: String::new(),
        run: String::new(),
    };
    let drive = crate::spaces_drive::drive()?;
    forget(
        &drive,
        &SpaceId(space.to_string()),
        &place,
        file,
    )
    .await?;
    index::refresh(store, space, agent).await
}

pub(crate) async fn with_memory(
    prompt: String,
    body: &Value,
    engine: &str,
    resumed: bool,
) -> String {
    if resumed || engine == "claude" {
        return prompt;
    }
    let Some(place) = place_in("", body) else {
        return prompt;
    };
    let Ok(drive) = crate::spaces_drive::drive() else {
        return prompt;
    };
    let space = SpaceId(place.space.clone());
    let Ok(Some((text, _))) =
        read_text(&drive, &space, &file_path(&place, INDEX), PROMPT_WAIT).await
    else {
        return prompt;
    };
    let capped = topics::capped(&text);
    if capped.trim().is_empty() {
        return prompt;
    }
    format!(
        "{prompt}\n\n# Your memory\nThis is MEMORY.md, the index of your memory in the Space's drive \
(.agents/{}/memory/). Read a topic in full with memory_read before relying on its line.\n\n{capped}",
        place.agent
    )
}

pub(crate) fn claude_memory_dir(req: &super::SendRequest) -> Option<String> {
    let token = super::mcp::token_in(req.mcp_servers.as_ref())?;
    let run = super::mcp::run_of(&token)?;
    let place = place_of(&run)?;
    memory_dir(&place).map(|dir| dir.to_string_lossy().into_owned())
}

fn folder_made(drive: &Drive, space: &SpaceId, path: &str) -> Result<(), space_drive::DriveError> {
    let mut parent = None;
    let mut so_far = String::new();
    for part in path.split('/').filter(|part| !part.is_empty()) {
        so_far = format!("{so_far}/{part}");
        let found = match drive.node_at(space, &so_far)? {
            Some(found) if found.kind == Kind::Folder => found,
            Some(_) => return Err(space_drive::DriveError::Exists),
            None => drive.create_resolving(
                space,
                NewNode {
                    parent: parent.clone(),
                    name: part.to_string(),
                    kind: Kind::Folder,
                    content: None,
                    mtime_ms: chrono::Utc::now().timestamp_millis(),
                    id: None,
                },
                true,
            )?,
        };
        parent = Some(found.id);
    }
    Ok(())
}

pub(crate) fn run_dirs(run_id: &str) -> Vec<String> {
    let Some(place) = place_of(run_id) else {
        return Vec::new();
    };
    let Some(dir) = memory_dir(&place) else {
        return Vec::new();
    };
    if !file_access::fs::is_dir(&dir) {
        let Ok(drive) = crate::spaces_drive::drive() else {
            return Vec::new();
        };
        if folder_made(
            &drive,
            &SpaceId(place.space.clone()),
            &memory_folder(&place),
        )
        .is_err()
        {
            return Vec::new();
        }
    }
    vec![dir.to_string_lossy().into_owned()]
}
