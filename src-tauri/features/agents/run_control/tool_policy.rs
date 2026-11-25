use serde_json::Value;

use super::run_taint::{url_asks, Taint};
use crate::engines::modes::ModeKind;

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct RunFacts {
    pub(crate) run_id: String,
    pub(crate) account: String,
    pub(crate) agent_id: String,
    pub(crate) task_id: String,
    pub(crate) mode_id: String,
    pub(crate) auto: bool,
    pub(crate) bypass: bool,
    pub(crate) planning: bool,
    pub(crate) person_prompt: String,
    pub(crate) parent_run_id: String,
    pub(crate) engine: bool,
    pub(crate) allowed_tools: Vec<String>,
    pub(crate) computer_use: bool,
    pub(crate) conversation_id: String,
    pub(crate) agent_delete: bool,
}

impl RunFacts {
    pub(crate) fn of_request(run_id: &str, body: &Value) -> Self {
        let text = |name: &str| {
            body.get(name)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned()
        };
        let delegated = !text("delegated_from").is_empty() || !text("parent_run_id").is_empty();
        let mode = super::engine_modes::of_request(body);
        let kind = mode.map(|mode| mode.kind);
        Self {
            run_id: run_id.to_owned(),
            account: text("account"),
            agent_id: text("agent_id"),
            task_id: text("task_id"),
            mode_id: mode.map(|mode| mode.id.to_owned()).unwrap_or_default(),
            auto: matches!(kind, Some(ModeKind::Edits | ModeKind::NoAsking)),
            bypass: kind == Some(ModeKind::NoAsking),
            planning: kind == Some(ModeKind::Plans),
            person_prompt: if delegated {
                String::new()
            } else {
                text("prompt")
            },
            parent_run_id: text("parent_run_id"),
            conversation_id: text("conversation_id"),
            engine: body["engine"]["id"]
                .as_str()
                .is_some_and(|id| !id.is_empty()),
            allowed_tools: body["allowed_tools"]
                .as_array()
                .map(|tools| {
                    tools
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
            computer_use: body["computer_use"].as_bool() == Some(true),
            agent_delete: false,
        }
    }
}

const ASK_MODE_STOPS: &[&str] = &[
    "agent.configure",
    "browser.act",
    "browser.fill_form",
    "browser.navigate",
    "browser.run",
    "browser.skill",
    "browser.steps",
    "browser.upload",
    "file.create",
    "file.promote_attachment",
    "file.update",
    "file.upload",
    "files.copy",
    "files.create_folder",
    "files.delete",
    "files.extract",
    "files.move",
    "files.rename",
    "files.tag",
    "files.trash",
    "files.zip",
    "folder.send",
    "item.delete",
    "item.rename",
    "media.fetch",
    "message.send",
    "shell.run",
    "space.manage",
    "thread.create",
    "thread.post",
];

const PLAN_REFUSES: &[&str] = &[
    "browser.tab.use",
    "browser.act",
    "browser.fill_form",
    "browser.navigate",
    "browser.request_user_action",
    "browser.run",
    "browser.skill",
    "browser.steps",
    "browser.upload",
    "files.copy",
    "files.create_folder",
    "files.delete",
    "files.extract",
    "files.move",
    "files.rename",
    "files.tag",
    "files.trash",
    "files.zip",
    "folder.send",
    "media.fetch",
    "screen.open",
    "shell.run",
];

const DELETE_WORDS: &[&str] = &[
    "delete", "remove", "purge", "unlink", "rm", "rmdir", "erase", "destroy", "wipe", "shred",
];

const DELETES_NO_FILE: &[&str] = &["item.delete"];

const FILES_DELETE: &str = "files.delete";

const MEMORY_READS: &[&str] = &["memory.read", "space.claims"];

const MEMORY_WRITES: &[&str] = &["memory.write", "memory.edit", "memory.forget"];

pub(crate) fn deletes(name: &str) -> bool {
    !name.starts_with("app.")
        && !DELETES_NO_FILE.contains(&name)
        && name.split(['.', '_', '-']).any(|word| {
            DELETE_WORDS
                .iter()
                .any(|delete| word.eq_ignore_ascii_case(delete))
        })
}

fn delete_decision(facts: &RunFacts, name: &str) -> Decision {
    if name != FILES_DELETE || !facts.agent_delete {
        return Decision::Refuse {
            code: "delete_off",
            message:
                "Agents don't delete files. Move what should go with the files trash tool: a Space's \
files go to its .trash and other files to the system Trash, where the person looks them over and \
deletes them themselves. Nothing was deleted."
                    .to_owned(),
        };
    }
    if facts.planning {
        return Decision::Refuse {
            code: "plan_mode",
            message: "Plan mode is read-only. Put this action in the plan as a step instead."
                .to_owned(),
        };
    }
    Decision::Ask {
        kind: "delete",
        why: "A deleted file can't be recovered.".to_owned(),
    }
}

pub(crate) const COMPUTER_READS: &[&str] = &[
    "computer.screenshot",
    "computer.list_displays",
    "computer.get_app_state",
    "computer.wait",
];

pub(crate) const COMPUTER_ACTS: &[&str] = &[
    "computer.mouse_move",
    "computer.left_click",
    "computer.right_click",
    "computer.middle_click",
    "computer.double_click",
    "computer.drag",
    "computer.scroll",
    "computer.type_text",
    "computer.press_key",
    "computer.press_element",
    "computer.set_element_value",
    "computer.sequence",
];

fn allowed_by_list(facts: &RunFacts, name: &str) -> bool {
    const ALWAYS: &[&str] = &[
        "conversation.ask_user",
        "log.work.write",
        "memory.read",
        "memory.write",
        "memory.edit",
        "memory.forget",
        "space.claims",
    ];
    facts.allowed_tools.is_empty()
        || ALWAYS.contains(&name)
        || facts.allowed_tools.iter().any(|allowed| {
            allowed == name
                || allowed
                    .strip_suffix(".*")
                    .or_else(|| allowed.strip_suffix('*'))
                    .is_some_and(|family| name.starts_with(family))
        })
}

pub(crate) const URL_TOOLS: &[&str] = &["browser.navigate", "screen.open", "web.fetch"];

fn consequential_goal(goal: &str) -> bool {
    static WORDS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    WORDS
        .get_or_init(|| {
            regex::Regex::new(r"(?i)\b(buy|purchas|pay (for|the|now|with|it)|payment|checkout|check out|order|book(ing)?|reserve|send|e-?mail|message|post|publish|tweet|share|invite|delete|remove|cancel|unsubscribe|subscribe|sign ?up|register|apply for|transfer|donate|submit (an? )?(application|order|payment|form))")
                .expect("a fixed pattern")
        })
        .is_match(goal)
}

pub(crate) fn kind_of(description: &str) -> &'static str {
    static KINDS: std::sync::OnceLock<[(regex::Regex, &'static str); 3]> =
        std::sync::OnceLock::new();
    let kinds = KINDS.get_or_init(|| {
        [
            (regex::Regex::new(r"(?i)\b(pay|buy|purchase|order|checkout|check out|donate|transfer|subscribe)\b").expect("a fixed pattern"), "payment"),
            (regex::Regex::new(r"(?i)\b(delete|remove|erase|discard|trash|cancel)\b").expect("a fixed pattern"), "delete"),
            (regex::Regex::new(r"(?i)\b(publish|post|tweet|share|make public)\b").expect("a fixed pattern"), "publish"),
        ]
    });
    kinds
        .iter()
        .find(|(words, _)| words.is_match(description))
        .map_or("send", |(_, kind)| kind)
}

#[derive(Debug, PartialEq)]
pub(crate) enum Decision {
    Run,
    Ask { kind: &'static str, why: String },
    Refuse { code: &'static str, message: String },
}

pub(crate) fn chat_of(facts: &RunFacts) -> String {
    if facts.conversation_id.is_empty() {
        format!("run:{}", facts.run_id)
    } else {
        facts.conversation_id.clone()
    }
}

fn ask(why: &str) -> Decision {
    Decision::Ask {
        kind: "action",
        why: why.to_owned(),
    }
}

fn text<'a>(input: &'a Value, name: &str) -> &'a str {
    input.get(name).and_then(Value::as_str).unwrap_or("")
}

pub(crate) fn prepared_input(name: &str, input: &Value) -> Value {
    if name == "browser.act"
        && input["allowConsequential"] == true
        && !consequential_goal(text(input, "goal"))
    {
        let mut cleared = input.clone();
        cleared["allowConsequential"] = Value::Bool(false);
        return cleared;
    }
    input.clone()
}

fn private_address_refusal(facts: &RunFacts, url: &str) -> Option<Decision> {
    let host = super::run_taint::private_host(url)?;
    if facts.person_prompt.to_lowercase().contains(&host) {
        return None;
    }
    Some(Decision::Refuse {
        code: "private_address",
        message: format!("{host} is a private address, and agents open those only when the person's own request names it. Nothing was opened."),
    })
}

pub(crate) fn decide(facts: &RunFacts, taint: &Taint, name: &str, input: &Value) -> Decision {
    if !allowed_by_list(facts, name) {
        return Decision::Refuse {
            code: "tool_not_allowed",
            message: format!("This agent isn't allowed to use {name}. Nothing was done."),
        };
    }
    if name.starts_with("app.") {
        let read_only = crate::apps::mcp::is_read_only(name);
        if facts.planning && !read_only {
            return Decision::Refuse {
                code: "plan_mode",
                message: "Plan mode is read-only. Put this action in the plan as a step instead."
                    .to_owned(),
            };
        }
        if read_only {
            return Decision::Run;
        }
        if crate::apps::mcp::is_paid(name) {
            return ask("This app can spend money or credits with a paid service.");
        }
        if facts.auto || crate::apps::mcp::approved_for(&chat_of(facts), name) {
            return Decision::Run;
        }
        return ask("The agent asks once to work in this app for this chat.");
    }
    if MEMORY_READS.contains(&name) {
        return Decision::Run;
    }
    if MEMORY_WRITES.contains(&name) {
        return if facts.planning {
            Decision::Refuse {
                code: "plan_mode",
                message: "Plan mode is read-only. Put what to remember in the plan instead."
                    .to_owned(),
            }
        } else {
            Decision::Run
        };
    }
    if deletes(name) {
        return delete_decision(facts, name);
    }
    let computer = COMPUTER_ACTS.contains(&name) || COMPUTER_READS.contains(&name);
    if computer && !facts.computer_use {
        return Decision::Refuse {
            code: "computer_use_off",
            message:
                "Screen control is off for this message. The person turns it on when they send."
                    .to_owned(),
        };
    }
    if facts.planning && COMPUTER_ACTS.contains(&name) {
        return Decision::Refuse {
            code: "plan_mode",
            message: "Plan mode is read-only. Put this action in the plan as a step instead."
                .to_owned(),
        };
    }
    if COMPUTER_ACTS.contains(&name) {
        return if facts.auto || facts.bypass {
            Decision::Run
        } else {
            ask("This acts on your screen with Misty's cursor.")
        };
    }
    if facts.planning && PLAN_REFUSES.contains(&name) {
        return Decision::Refuse {
            code: "plan_mode",
            message: "Plan mode is read-only. Put this action in the plan as a step instead."
                .to_owned(),
        };
    }
    let url = text(input, "url");
    if URL_TOOLS.contains(&name) && !url.is_empty() {
        if name != "web.fetch" {
            if let Some(refused) = private_address_refusal(facts, url) {
                return refused;
            }
        }
        if let Some(why) = url_asks(url, taint) {
            return Decision::Ask {
                kind: "action",
                why,
            };
        }
    }
    if name == "browser.run" {
        for found in super::run_taint::urls_in_code(text(input, "code")) {
            if let Some(why) = url_asks(&found, taint) {
                return Decision::Ask {
                    kind: "action",
                    why,
                };
            }
        }
    }
    if name == "agent.configure" && !text(input, "instructions").trim().is_empty() {
        return ask("These instructions go into the agent's every run.");
    }
    if name == "browser.act"
        && input["allowConsequential"] == true
        && consequential_goal(text(input, "goal"))
    {
        return Decision::Ask {
            kind: kind_of(text(input, "goal")),
            why: String::new(),
        };
    }
    if name.starts_with("files.") && ASK_MODE_STOPS.contains(&name) && !facts.bypass {
        return ask("");
    }
    let opens_page = name == "browser.navigate" || name == "screen.open";
    if !(facts.auto || (facts.engine && opens_page))
        && (ASK_MODE_STOPS.contains(&name) || (name == "screen.open" && !url.is_empty()))
    {
        return ask("");
    }
    Decision::Run
}

#[cfg(test)]
#[path = "tool_policy_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "tool_policy_files_tests.rs"]
mod files_tests;
