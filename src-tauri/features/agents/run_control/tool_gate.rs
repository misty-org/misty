//! Where a call meets the policy (`tool_policy`), before it reaches a window: the run's facts, what it
//! has read, and the person's answer in the island. A window hears only the outcome.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock, PoisonError},
};

use agent_runs::local_tools::{LocalToolCall, LocalToolOutcome};
use serde_json::Value;
use tauri::AppHandle;

use super::{
    run_taint,
    tool_policy::{decide, prepared_input, Decision, RunFacts},
    tool_question::{page_refs, question_text, Controls},
};
use crate::browser::agent_pages::action_confirm as confirm;
use database::store::Store;

/// How far a run's parents are followed. Sub-agents are one level deep today.
const MAX_FAMILY: usize = 4;

/// A call a window is running, by the id it was asked under. Native page work finds its run through it,
/// so a window never says what mode it's in.
#[derive(Clone, Debug)]
pub(crate) struct ActiveCall {
    pub(crate) facts: RunFacts,
    pub(crate) tool: String,
}

fn active() -> &'static Mutex<HashMap<String, ActiveCall>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, ActiveCall>>> = OnceLock::new();
    ACTIVE.get_or_init(Default::default)
}

pub(crate) fn begin_active(id: &str, facts: &RunFacts, tool: &str) {
    active()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(
            id.to_owned(),
            ActiveCall {
                facts: facts.clone(),
                tool: tool.to_owned(),
            },
        );
}

pub(crate) fn end_active(id: &str) {
    active()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(id);
}

pub(crate) fn active_call(id: &str) -> Option<ActiveCall> {
    active()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(id)
        .cloned()
}

/// The run as it was started, or Ask with nothing known when nobody can say.
pub(crate) async fn facts_of_run(app: &AppHandle, run_id: &str) -> RunFacts {
    // A run on an outside engine is known to its adapter, not to Misty's runtime.
    if let Some(body) = crate::engines::runs::request_of(run_id) {
        return RunFacts::of_request(run_id, &body);
    }
    let body = super::ensure(app)
        .await
        .ok()
        .and_then(|running| running.runtime.local_request(run_id));
    body.map_or_else(
        || RunFacts {
            run_id: run_id.to_owned(),
            ..RunFacts::default()
        },
        |body| RunFacts::of_request(run_id, &body),
    )
}

/// The run and those it reports to: what any of them read may reach the others.
async fn family(app: &AppHandle, facts: &RunFacts) -> Vec<String> {
    let mut runs = vec![facts.run_id.clone()];
    let mut parent = facts.parent_run_id.clone();
    while !parent.is_empty() && runs.len() < MAX_FAMILY && !runs.contains(&parent) {
        runs.push(parent.clone());
        parent = facts_of_run(app, &parent).await.parent_run_id;
    }
    runs
}

fn rejected(code: &str, message: String) -> LocalToolOutcome {
    LocalToolOutcome::Rejected {
        code: code.to_owned(),
        message,
    }
}

/// Whether the person's answer lets the call go on, and if not what the model hears.
fn refusal_of(answer: confirm::Answer, title: &str) -> Option<LocalToolOutcome> {
    match answer {
        confirm::Answer::Allowed => None,
        confirm::Answer::Refused => Some(rejected("approval_declined", format!("The user declined “{title}”. Do not retry it; continue without it or ask the user."))),
        confirm::Answer::Unanswered => Some(rejected("approval_expired", format!("The approval request for “{title}” expired without an answer, which counts as declined. Call the tool again to ask the user again."))),
    }
}

pub(crate) enum Admission {
    /// Go on, with this input.
    Run(Value),
    Done(LocalToolOutcome),
}

async fn ask(
    app: &AppHandle,
    store: &Store,
    facts: &RunFacts,
    runs: &[String],
    call: &LocalToolCall,
    kind: &'static str,
    why: &str,
) -> Option<LocalToolOutcome> {
    let scope = call.input["scopeId"].as_str().unwrap_or("");
    let refs = page_refs(&call.name, &call.input);
    let controls: Controls = if refs.is_empty() {
        Controls::new()
    } else {
        crate::browser::page_controls(app, scope, &refs).await
    };
    let text = match question_text(&call.name, &call.input, &controls) {
        Ok(text) => text,
        Err(message) => return Some(rejected("question_too_long", message.to_owned())),
    };
    let site = crate::browser::scope_site(app, scope);
    let answer = confirm::ask_tool(
        app,
        confirm::ToolAsk {
            account: &facts.account,
            kind,
            control: &text,
            reason: why,
            site: &site,
            agent_id: &facts.agent_id,
            task_id: &facts.task_id,
        },
    )
    .await;
    let title = super::tool_question::tool_title(&call.name);
    if let Some(refused) = refusal_of(answer, &title) {
        return Some(refused);
    }
    // What the person saw and allowed: that host may take queries for the rest of the run.
    if let Some(url) = call.input["url"].as_str() {
        run_taint::approve_host(store, runs, url);
    }
    if call.name == "browser.run" {
        for url in run_taint::urls_in_code(call.input["code"].as_str().unwrap_or("")) {
            run_taint::approve_host(store, runs, &url);
        }
    }
    None
}

/// One call's way through the policy. A question ends here, in native code, before a window hears of it.
pub(crate) async fn admit(
    app: &AppHandle,
    store: &Store,
    facts: &RunFacts,
    call: &LocalToolCall,
) -> Admission {
    let runs = family(app, facts).await;
    let taint = run_taint::load(store, &runs);
    let input = prepared_input(&call.name, &call.input);
    match decide(facts, &taint, &call.name, &input) {
        Decision::Run => Admission::Run(input),
        Decision::Refuse { code, message } => Admission::Done(rejected(code, message)),
        Decision::Ask { kind, why } => {
            match ask(app, store, facts, &runs, call, kind, &why).await {
                Some(refused) => Admission::Done(refused),
                None => Admission::Run(input),
            }
        }
    }
}

/// Notes what a call that ran has read.
pub(crate) async fn note_result(
    app: &AppHandle,
    store: &Store,
    facts: &RunFacts,
    call: &LocalToolCall,
) {
    let runs = family(app, facts).await;
    run_taint::note_call(store, &runs, &call.name, &call.input);
}

/// A program opening an address at run time, which its text couldn't show. `Err` is what its program
/// hears; nothing was opened.
pub(crate) async fn program_opens(
    app: &AppHandle,
    store: &Store,
    active: &ActiveCall,
    url: &str,
) -> Result<(), String> {
    let call = LocalToolCall {
        run_id: active.facts.run_id.clone(),
        call_id: String::new(),
        turn: 0,
        name: "browser.navigate".to_owned(),
        input: serde_json::json!({ "url": url }),
    };
    let runs = family(app, &active.facts).await;
    let taint = run_taint::load(store, &runs);
    let auto = RunFacts {
        auto: true,
        ..active.facts.clone()
    };
    let outcome = match decide(&auto, &taint, &call.name, &call.input) {
        Decision::Run => None,
        Decision::Refuse { code, message } => Some(rejected(code, message)),
        Decision::Ask { kind, why } => {
            ask(app, store, &active.facts, &runs, &call, kind, &why).await
        }
    };
    match outcome {
        None => Ok(()),
        Some(LocalToolOutcome::Rejected { message, .. }) => Err(message),
        Some(_) => Err("That address was not opened.".to_owned()),
    }
}

/// A program about to open a tab of its own: the window asks here, and hears only the answer.
#[tauri::command]
pub async fn agent_program_opens(
    app: AppHandle,
    webview: tauri::Webview,
    policy_call: String,
    url: String,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can run agents.".into());
    }
    let active = active_call(&policy_call)
        .filter(|call| call.tool == "browser.run")
        .ok_or("That program has stopped.")?;
    let store = tauri::Manager::state::<crate::app::runtime::MistyRuntime>(&app)
        .environment
        .store();
    program_opens(&app, &store, &active, &url).await
}

/// What the person's settings say about agents on this computer.
#[derive(Clone, Debug, Default)]
pub(crate) struct AgentSettings {
    pub(crate) app_actions_ask: bool,
    /// `None` when they can't be read, which keeps the safe defaults.
    pub(crate) site_blocks: Option<crate::browser::SiteBlocks>,
    pub(crate) confirm_kinds: Option<Vec<String>>,
}

/// This computer's agent settings, as the app's settings page keeps them.
pub(crate) fn agent_settings(store: &Store) -> AgentSettings {
    let read = || -> Option<Value> {
        let connection = store.connect().ok()?;
        let document: String = connection
            .query_row(
                "SELECT document FROM settings_state WHERE scope = 'device:agent-settings'",
                [],
                |row| row.get(0),
            )
            .ok()?;
        serde_json::from_str(&document).ok()
    };
    let Some(document) = read() else {
        return AgentSettings::default();
    };
    let settings = &document["settings"];
    AgentSettings {
        app_actions_ask: settings["app_actions_ask"].as_bool().unwrap_or(false),
        site_blocks: Some(crate::browser::SiteBlocks {
            sensitive: settings["agent_block_sensitive"].as_bool().unwrap_or(true),
            sites: settings["agent_blocked_sites"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|site| site.as_str().map(str::to_owned))
                .collect(),
        }),
        confirm_kinds: settings["agent_confirm_kinds"].as_array().map(|kinds| {
            kinds
                .iter()
                .filter_map(|kind| kind.as_str().map(str::to_owned))
                .collect()
        }),
    }
}

/// What a person remembered for this agent, on this computer: "Accept and remember" in the island.
fn site_grants(store: &Store, facts: &RunFacts) -> Vec<confirm::SiteGrant> {
    let read = || -> rusqlite::Result<Vec<Value>> {
        let connection = store.connect()?;
        let mut statement = connection
            .prepare("SELECT document FROM agent_chats WHERE account = ?1 AND kind = 'agent'")?;
        let rows = statement.query_map([&facts.account], |row| row.get::<_, String>(0))?;
        Ok(rows
            .flatten()
            .filter_map(|text| serde_json::from_str(&text).ok())
            .collect())
    };
    let documents = read().unwrap_or_default();
    let builtin = || {
        documents
            .iter()
            .find(|row| row["system_managed"] == true)
            .and_then(|row| row["id"].as_str())
            .unwrap_or("")
    };
    let own = if facts.agent_id.is_empty() || facts.agent_id == "misty-unified" {
        builtin()
    } else {
        facts.agent_id.as_str()
    };
    grants_of(&documents, own)
}

fn grants_of(documents: &[Value], agent: &str) -> Vec<confirm::SiteGrant> {
    documents
        .iter()
        .filter(|row| {
            row["id"]
                .as_str()
                .is_some_and(|id| id.starts_with("sitegrant_"))
        })
        .filter(|row| {
            !agent.is_empty() && row["agent_id"] == agent && row["scope_kind"] == "origin"
        })
        .filter_map(|row| {
            let kind = match row["action"].as_str()? {
                "browser.send" => "send",
                "browser.delete" => "delete",
                "browser.publish" => "publish",
                _ => return None,
            };
            Some(confirm::SiteGrant {
                kind: kind.to_owned(),
                origin: row["scope_id"].as_str()?.to_owned(),
            })
        })
        .collect()
}

/// What native page work goes by for one request, read here and never taken from the window. A request
/// with no call behind it knows no run: it reads as Ask, with nothing remembered.
pub(crate) fn page_policy(store: &Store, policy_call: Option<&str>) -> crate::browser::PagePolicy {
    let settings = agent_settings(store);
    let call = policy_call.and_then(active_call);
    let grant_set = call.as_ref().map(|call| confirm::GrantSet {
        mode: if call.facts.auto { "auto" } else { "ask" }.to_owned(),
        grants: if call.facts.auto {
            site_grants(store, &call.facts)
        } else {
            Vec::new()
        },
    });
    crate::browser::PagePolicy {
        call,
        site_blocks: settings.site_blocks,
        confirm_kinds: settings.confirm_kinds,
        grant_set,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_mode_comes_only_from_an_open_call() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        assert!(page_policy(&store, None).grant_set.is_none());
        assert!(page_policy(&store, Some("nobody")).grant_set.is_none());
        let facts = RunFacts {
            run_id: "r".into(),
            auto: true,
            ..RunFacts::default()
        };
        begin_active("open", &facts, "browser.steps");
        assert_eq!(
            page_policy(&store, Some("open")).grant_set.unwrap().mode,
            "auto"
        );
        end_active("open");
        assert!(page_policy(&store, Some("open")).grant_set.is_none());
    }

    #[test]
    fn settings_read_natively_with_safe_defaults() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let unset = agent_settings(&store);
        assert!(
            !unset.app_actions_ask && unset.site_blocks.is_none() && unset.confirm_kinds.is_none()
        );
        store
            .connect()
            .unwrap()
            .execute(
                "INSERT INTO settings_state(scope,revision,document) VALUES('device:agent-settings',1,?1)",
                [json!({ "settings": { "app_actions_ask": true, "agent_block_sensitive": false, "agent_blocked_sites": ["a.example"] } }).to_string()],
            )
            .unwrap();
        let read = agent_settings(&store);
        assert!(read.app_actions_ask);
        let blocks = read.site_blocks.unwrap();
        assert!(!blocks.sensitive);
        assert_eq!(blocks.sites, ["a.example"]);
        assert!(read.confirm_kinds.is_none());
    }

    #[test]
    fn only_this_agents_grants_on_an_exact_origin_count() {
        let rows = [
            json!({ "id": "sitegrant_a", "agent_id": "a", "action": "browser.send", "scope_kind": "origin", "scope_id": "https://mail.example" }),
            json!({ "id": "sitegrant_b", "agent_id": "b", "action": "browser.send", "scope_kind": "origin", "scope_id": "https://other.example" }),
            json!({ "id": "sitegrant_c", "agent_id": "a", "action": "payment", "scope_kind": "origin", "scope_id": "https://pay.example" }),
            json!({ "id": "other", "agent_id": "a", "action": "browser.send", "scope_kind": "origin", "scope_id": "https://nope.example" }),
        ];
        let grants = grants_of(&rows, "a");
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].origin, "https://mail.example");
        assert!(grants_of(&rows, "").is_empty());
    }
}
