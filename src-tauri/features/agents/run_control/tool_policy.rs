//! Which tool asks when. Native on purpose: the run's mode
//! comes from the request it was started with, never from the renderer at call time or from the model,
//! and nothing here reads what a page or a tool result says. Auto doesn't stop for ordinary work; what
//! stops in both modes is listed in `decide`.
use serde_json::Value;

use super::run_taint::{url_asks, Taint};

/// What the run was started as. A run nobody can account for reads as Ask, the safe reading.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct RunFacts {
    pub(crate) run_id: String,
    pub(crate) account: String,
    pub(crate) agent_id: String,
    pub(crate) task_id: String,
    pub(crate) auto: bool,
    pub(crate) planning: bool,
    /// What the person asked for. Empty for a sub-agent: its request is another model's words.
    pub(crate) person_prompt: String,
    pub(crate) parent_run_id: String,
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
        // A turn that chooses no mode takes the chat's saved one, and with no chat there's no plan.
        let chat = text("conversation_id");
        let mut mode = text("collaboration_mode");
        if mode.is_empty() && !chat.is_empty() {
            mode = body["collaboration"]["mode"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_owned();
        }
        Self {
            run_id: run_id.to_owned(),
            account: text("account"),
            agent_id: text("agent_id"),
            task_id: text("task_id"),
            auto: text("permission_mode") == "auto",
            planning: mode == "plan" && !chat.is_empty(),
            person_prompt: if delegated {
                String::new()
            } else {
                text("prompt")
            },
            parent_run_id: text("parent_run_id"),
        }
    }
}

/// What stops in Ask, before it reaches the window. Everything else is a read.
const ASK_MODE_STOPS: &[&str] = &[
    "agent.configure",
    "browser.act",
    "browser.fill_form",
    "browser.navigate",
    "browser.run",
    "browser.skill",
    "browser.steps",
    "browser.upload",
    "drawing.apply",
    "drawing.create",
    "file.promote_attachment",
    "file.update",
    "folder.send",
    "item.delete",
    "item.rename",
    "memory.pref.forget",
    "memory.pref.remember",
    "memory.pref.update",
    "memory.workflow.unschedule",
    "message.send",
    "note.create",
    "note.tag",
    "note.update",
    "shell.run",
    "space.manage",
    "thread.create",
    "thread.post",
];

/// A saved workflow later runs as the person's own request in Auto, so a page must never be able to
/// plant one: these stop in both modes.
const ALWAYS_STOPS: &[&str] = &[
    "memory.workflow.save",
    "memory.workflow.learn",
    "memory.workflow.schedule",
];

/// A person's browsing history is theirs to hand over, whatever the mode.
const HISTORY_STOPS: &[&str] = &[
    "memory.history.search",
    "memory.history.timeline",
    "memory.tree.read",
];

/// What Plan mode refuses whatever the catalog offered: tools that change something on this computer.
const PLAN_REFUSES: &[&str] = &[
    "browser.act",
    "browser.fill_form",
    "browser.navigate",
    "browser.request_user_action",
    "browser.run",
    "browser.skill",
    "browser.steps",
    "browser.upload",
    "folder.send",
    "screen.open",
    "shell.run",
];

/// The tools that open an address, and the field that names it.
pub(crate) const URL_TOOLS: &[&str] = &["browser.navigate", "screen.open", "web.fetch"];

/// What a screen goal may only do with the person's approval, as the model's own flag claims it.
fn consequential_goal(goal: &str) -> bool {
    static WORDS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    WORDS
        .get_or_init(|| {
            regex::Regex::new(r"(?i)\b(buy|purchas|pay (for|the|now|with|it)|payment|checkout|check out|order|book(ing)?|reserve|send|e-?mail|message|post|publish|tweet|share|invite|delete|remove|cancel|unsubscribe|subscribe|sign ?up|register|apply for|transfer|donate|submit (an? )?(application|order|payment|form))")
                .expect("a fixed pattern")
        })
        .is_match(goal)
}

/// Which page kind a description names, for the island's words.
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
    /// Asks the person. `kind` is a page kind, or "action" for any other step.
    Ask {
        kind: &'static str,
        why: String,
    },
    Refuse {
        code: &'static str,
        message: String,
    },
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

/// Clears `allowConsequential` on a goal that names nothing consequential: a model set it on "enter
/// 55500 and click Calculate", and each time the run stopped. The click itself is still judged natively.
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

/// One call's verdict. Reads whose results an instruction could hide in never stop here, unless a
/// private read came first.
pub(crate) fn decide(facts: &RunFacts, taint: &Taint, name: &str, input: &Value) -> Decision {
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
    if ALWAYS_STOPS.contains(&name) {
        return ask("A saved workflow runs later as your own request.");
    }
    if HISTORY_STOPS.contains(&name) {
        return ask("");
    }
    if name == "memory.history.forget" {
        return Decision::Ask {
            kind: "delete",
            why: String::new(),
        };
    }
    if name == "memory.pref.remember" && taint.page_read {
        return ask("This run read a web page, which may be where this came from.");
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
    if !facts.auto && (ASK_MODE_STOPS.contains(&name) || (name == "screen.open" && !url.is_empty()))
    {
        return ask("");
    }
    Decision::Run
}

#[cfg(test)]
#[path = "tool_policy_tests.rs"]
mod tests;
