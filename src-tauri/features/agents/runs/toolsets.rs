//! agent.tool. A run starts in answer: everything that reads,
//! searches, fetches pages or works with the person's own data. browse and desktop add the tools
//! that act on a screen; agent.tool.load adds connected apps or sub-agents. The model sees only what
//! its current agent.tool allows, so a quick answer never wades through browser and desktop tools.
use std::sync::LazyLock;

use regex::Regex;

use crate::model_calls::{AssistantPart, Message, RawJson, ToolDefinition};

use super::{
    js_json::JsValue,
    js_regex::js_regex,
    model_tools::ModelCatalog,
    tool_transport::{object, string},
    transcript::input_value,
};

pub(crate) const TOOL_USE_TOOL: &str = "agent_tool_use";
pub(crate) const TOOL_LOAD_TOOL: &str = "agent_tool_load";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Toolset {
    Answer,
    Browse,
    Desktop,
}

impl Toolset {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Answer => "answer",
            Self::Browse => "browse",
            Self::Desktop => "desktop",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        [Self::Answer, Self::Browse, Self::Desktop].into_iter().find(|set| set.as_str() == name)
    }

    fn words(self) -> &'static str {
        match self {
            Self::Answer => "answer: read, search, fetch pages and work with the person's own data (the default)",
            Self::Browse => "browse: also the single-step page tools (snapshot, steps, forms, page skills, screen agent) for what a browser_run program cannot do",
            Self::Desktop => "desktop: also control other apps on the person's computer",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Family {
    Integration,
    Agent,
    Misty,
}

impl Family {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Integration => "integration",
            Self::Agent => "agent",
            Self::Misty => "misty",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        [Self::Integration, Self::Agent, Self::Misty].into_iter().find(|family| family.as_str() == name)
    }

    fn words(self) -> &'static str {
        match self {
            Self::Integration => "integration: the person's connected apps (Gmail, Calendar, Slack, GitHub and others)",
            Self::Agent => "agent: sub-agents that work on independent parts of a large task at the same time",
            Self::Misty => "misty: the person's own Misty notes, drawings, files, chats, Spaces, memory, saved workflows and bookmarks",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Group {
    Set(Toolset),
    Family(Family),
}

// The person's Misty data and its social and workflow tools: about 50 of a run's 65 tools and
// 9,000 tokens on every turn of a web task that never uses them.
// They load up front when the request is about Misty's own things, and otherwise on request.
const MISTY_DATA: [&str; 16] = [
    "memory.workflow.", "memory.pref.", "drawing.", "note.", "thread.", "file.", "voice.", "message.", "space.",
    "bookmark.", "item.", "search.all", "agent.configure", "agent.request", "agent.directory", "agent.list",
];

static MISTY_REQUEST: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"\b(my|our|this|the person's) (own )?(notes?|notebook|drawings?|sketch(es)?|files?|documents in misty|chats?|threads?|messages in misty|spaces?|bookmarks?|saved workflows?|workflows?|memory|memories|preferences|recordings?|voice notes?|schedules?|agents?)\b|\b(in|on|from|to) misty\b|\bmisty('s)? (notes?|files?|chat|spaces?|drawings?|bookmarks?)\b|\bremember (that|this|my|me)\b|\bweather\b|\b(a|the|this) space\b",
        true,
    )
});

// A request that names an app people connect: the
// app tools load up front, so the first action comes a turn after the request, not three.
static APP_REQUEST: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"\b(e-?mail|gmail|inbox|outlook|calendar|meeting invite|slack|github|pull request|notion|linear|jira|asana|trello|google (docs?|sheets?|drive|calendar)|drive folder|spreadsheet in (my )?drive|hubspot|salesforce|dropbox|figma|discord|my (contacts|events|repos?|channels?))\b",
        true,
    )
});

/// Which agent.tool a catalog tool (Misty name) belongs to; `None` is answer.
fn toolset_of(name: &str) -> Option<Group> {
    // Opening the agent's own tab is how a run reads what a fetch can't, so it stays in answer, and
    // so does a program against those tabs. Checked
    // before the browser prefix, which would put browser.run behind browse with the step tools.
    if name == "screen.open" || name == "browser.run" {
        return None;
    }
    if name.starts_with("browser.workspace.") {
        return Some(Group::Set(Toolset::Desktop));
    }
    if name.starts_with("browser.") && !name.starts_with("browser.tab.") {
        return Some(Group::Set(Toolset::Browse));
    }
    if name.starts_with("integration.") {
        return Some(Group::Family(Family::Integration));
    }
    if name == "agent.delegate" || name == "agent.wait" {
        return Some(Group::Family(Family::Agent));
    }
    if MISTY_DATA.iter().any(|prefix| name.starts_with(prefix)) {
        return Some(Group::Family(Family::Misty));
    }
    None
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ToolState {
    pub(crate) toolset: Toolset,
    pub(crate) loaded: Vec<Family>,
    pub(crate) seen: bool,
}

/// The run's agent.tool and loaded families, read back from its own tool calls so a replayed run agrees.
pub(crate) fn tool_state(messages: &[Message], initial: Toolset) -> ToolState {
    let mut state = ToolState { toolset: initial, loaded: Vec::new(), seen: false };
    for message in messages {
        let Message::Assistant { content, .. } = message else {
            continue;
        };
        for part in content {
            let AssistantPart::ToolCall { tool_name, input, .. } = part else {
                continue;
            };
            if tool_name != TOOL_USE_TOOL && tool_name != TOOL_LOAD_TOOL {
                continue;
            }
            let input = input_value(input);
            let field = |name: &str| input.get(name).and_then(JsValue::as_str);
            if tool_name == TOOL_USE_TOOL {
                if let Some(toolset) = field("tool").and_then(Toolset::parse) {
                    state.toolset = toolset;
                    state.seen = true;
                }
            } else if let Some(family) = field("family").and_then(Family::parse) {
                if !state.loaded.contains(&family) {
                    state.loaded.push(family);
                }
                state.seen = true;
            }
        }
    }
    state
}

pub(crate) struct AgentTools<'a> {
    pub(crate) tools: Vec<ToolDefinition>,
    pub(crate) instructions: String,
    pub(crate) initial: Toolset,
    catalog: &'a ModelCatalog,
    programs: bool,
    preloaded: Vec<Family>,
}

impl AgentTools<'_> {
    /// Model names visible under the state, with the runtime's own tools.
    pub(crate) fn visible(&self, all: &[String], state: &ToolState) -> Vec<String> {
        all.iter()
            .filter(|model_name| {
                let name = self.catalog.misty_name(model_name);
                // browser.tab.* act on the person's own tabs, which an agent never touches (its own tabs
                // are listed and opened by browser_run): offered, they only fail, and a failed open ends the run.
                if self.programs && name.starts_with("browser.tab.") {
                    return false;
                }
                match toolset_of(name) {
                    None => true,
                    Some(Group::Set(set)) => set == state.toolset,
                    Some(Group::Family(family)) => state.loaded.contains(&family) || self.preloaded.contains(&family),
                }
            })
            .cloned()
            .collect()
    }
}

fn enum_schema(field: &str, values: &[&str]) -> RawJson {
    let values = JsValue::Array(values.iter().map(|value| string(*value)).collect());
    let schema = object([
        ("type", string("object")),
        ("required", JsValue::Array(vec![string(field)])),
        ("additionalProperties", JsValue::Bool(false)),
        ("properties", object([(field, object([("type", string("string")), ("enum", values)]))])),
    ]);
    RawJson::from_text(schema.stringify()).unwrap_or_else(|_| RawJson::empty_object())
}

fn definition(name: &str, description: String, input_schema: RawJson) -> ToolDefinition {
    ToolDefinition { kind: "function".to_owned(), name: name.to_owned(), description: Some(description), input_schema, strict: None }
}

pub(crate) fn agent_tools<'a>(catalog: &'a ModelCatalog, request: &str) -> AgentTools<'a> {
    let groups: Vec<Group> = catalog.tools.iter().filter_map(|tool| toolset_of(&tool.descriptor.name)).collect();
    let toolsets: Vec<Toolset> = [Toolset::Answer, Toolset::Browse, Toolset::Desktop]
        .into_iter()
        .filter(|set| *set == Toolset::Answer || groups.contains(&Group::Set(*set)))
        .collect();
    let has_tool = |wanted: &str| catalog.tools.iter().any(|tool| tool.descriptor.name == wanted);
    // Browser tools exist only once a browser is attached (a screen the agent
    // opened, or a tab the person shared), so such a run starts in browse, unless it
    // has browser_run: then pages are worked with programs, and the 17 single-step
    // tools wait behind browse.
    let programs = has_tool("browser.run");
    let attached = catalog.tools.iter().any(|tool| {
        let name = tool.descriptor.name.as_str();
        name.starts_with("browser.") && toolset_of(name) == Some(Group::Set(Toolset::Browse)) && name != "browser.request_user_action"
    });
    let initial = if !programs && attached { Toolset::Browse } else { Toolset::Answer };
    let families: Vec<Family> = [Family::Integration, Family::Agent, Family::Misty]
        .into_iter()
        .filter(|family| groups.contains(&Group::Family(*family)))
        .collect();
    let offered = |family: Family| families.contains(&family);
    // A request about Misty's own things starts with them loaded.
    let mut preloaded = Vec::new();
    if offered(Family::Misty) && MISTY_REQUEST.is_match(request) {
        preloaded.push(Family::Misty);
    }
    if offered(Family::Integration) && APP_REQUEST.is_match(request) {
        preloaded.push(Family::Integration);
    }
    // A run with its own tabs splits a broad task across sub-agents; behind agent_tool_load they were never used, and 10-to-20-item tasks ran one by one.
    if offered(Family::Agent) && has_tool("screen.open") {
        preloaded.push(Family::Agent);
    }

    let set_names: Vec<&str> = toolsets.iter().map(|set| set.as_str()).collect();
    let family_names: Vec<&str> = families.iter().map(|family| family.as_str()).collect();
    let mut tools = Vec::new();
    if toolsets.len() > 1 {
        let words: Vec<&str> = toolsets.iter().map(|set| set.words()).collect();
        tools.push(definition(
            TOOL_USE_TOOL,
            format!("Switch what this run can do, only when the request needs it. {}. The new tools are available from your next step.", words.join("; ")),
            enum_schema("tool", &set_names),
        ));
    }
    if !families.is_empty() {
        let words: Vec<&str> = families.iter().map(|family| family.words()).collect();
        tools.push(definition(
            TOOL_LOAD_TOOL,
            format!("Add a group of tools when the task needs it: {}.", words.join("; ")),
            enum_schema("family", &family_names),
        ));
    }
    let instructions = if toolsets.len() > 1 || !families.is_empty() {
        let opening = if initial == Toolset::Answer { ", with tools to read, search, fetch pages and work with the person's own data" } else { "" };
        let switch = if toolsets.len() > 1 {
            let others: Vec<&str> = set_names.iter().copied().filter(|name| *name != "answer").collect();
            format!("Call {TOOL_USE_TOOL} to switch when the request needs more: {}. ", others.join(", "))
        } else {
            String::new()
        };
        let load = if families.is_empty() { String::new() } else { format!("Call {TOOL_LOAD_TOOL} to add {} tools. ", family_names.join(" or ")) };
        format!("Tools: this run starts in agent.tool.{}{opening}. {switch}{load}Don't switch for something you can answer or read without it.", initial.as_str())
    } else {
        String::new()
    };
    AgentTools { tools, instructions, initial, catalog, programs, preloaded }
}

/// Runs `agent_tool_use` or `agent_tool_load`, or `None` for any other tool.
pub(crate) fn run_toolset_tool(tool_name: &str, input: &JsValue) -> Option<JsValue> {
    if tool_name == TOOL_USE_TOOL {
        let name = input.get("tool").map(JsValue::to_js_string).unwrap_or_default();
        let note = format!("Now in agent.tool.{name}.");
        return Some(object([("toolset", string(name)), ("note", string(note))]));
    }
    if tool_name == TOOL_LOAD_TOOL {
        return Some(object([("loaded", input.get("family").cloned().unwrap_or(JsValue::Null))]));
    }
    None
}

#[cfg(test)]
#[path = "toolsets_tests.rs"]
mod tests;
