//! Running one app tool. The decisions that must hold whatever the renderer does live here: which account
//! a call runs as, whether a write needs the person, and that one approval covers one exact action.
use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{json, Value};

use super::AccountStore as Store;
use super::{
    api::{valid_tool_slug, Account},
    apps::on_store,
    client::{truncate, Client},
    grants,
    policy::{self, Decision, Kind},
    requests::{self, Draft, Remember, RequestView},
    tools::{failure, rejected, storage_failure, Failure},
};

/// The model sees at most this much of one app result.
const RESULT_LIMIT: usize = 48 << 10;

/// One call's input, after the handler's own checks.
pub struct ExecuteCall {
    pub run_id: String,
    pub tool_slug: String,
    pub arguments: Value,
    pub account: String,
    /// The run's Ask or Auto. Anything else counts as Ask.
    pub mode: String,
}

/// The call ran, or it's waiting on the person.
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Executed {
    Done { result: Value },
    Waiting { title: String, request: RequestView },
}

/// The account one call runs as: named explicitly, so Composio never falls back to another of the
/// person's accounts. `requested` may be an ID or alias; empty means their only one for the app.
fn resolve_account(
    accounts: &[Account],
    toolkit: &str,
    requested: &str,
) -> Result<String, Failure> {
    let own: Vec<&Account> = accounts
        .iter()
        .filter(|item| item.active() && item.toolkit.slug == toolkit)
        .collect();
    let choices = || {
        own.iter()
            .map(|item| match item.alias() {
                "" => item.id.clone(),
                alias => format!("{} ({alias})", item.id),
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    if own.is_empty() {
        return Err(rejected(
            "invalid_request",
            format!(
                "The user has not connected {toolkit}. Call integration_connect with app {toolkit} first."
            ),
        ));
    }
    if requested.is_empty() {
        return match own.as_slice() {
            [only] => Ok(only.id.clone()),
            _ => Err(rejected(
                "invalid_request",
                format!(
                    "The user has several {toolkit} accounts. Pass account as one of: {}.",
                    choices()
                ),
            )),
        };
    }
    own.iter()
        .find(|item| item.id == requested || (!item.alias().is_empty() && item.alias() == requested))
        .map(|item| item.id.clone())
        .ok_or_else(|| {
            rejected(
                "invalid_request",
                format!(
                    "That {toolkit} account isn't one of the user's. Pass account as one of: {}, or leave it out.",
                    choices()
                ),
            )
        })
}

/// Runs one app tool. Reads run directly. A write asks the person when its rule says to, and a card
/// answered earlier, in this run or the one that handed off to this one, is used up here.
pub async fn execute(
    client: &Client,
    store: &Store,
    call: ExecuteCall,
) -> Result<Executed, Failure> {
    if !valid_tool_slug(&call.tool_slug) {
        return Err(rejected(
            "invalid_request",
            "tool_slug must be an exact slug from integration_search, such as GMAIL_SEND_EMAIL",
        ));
    }
    let info = client.tool(&call.tool_slug).await.map_err(|error| {
        if error.not_found() {
            rejected(
                "invalid_request",
                format!(
                    "Unknown app tool {}. Use integration_search to find exact slugs.",
                    call.tool_slug
                ),
            )
        } else {
            failure(error, false)
        }
    })?;
    let accounts = client
        .accounts("")
        .await
        .map_err(|error| failure(error, false))?;
    let account = resolve_account(&accounts, &info.toolkit.slug, call.account.trim())?;
    let kind = policy::classify(&info.slug, &info.tags);
    if kind == Kind::Read {
        return run_tool(client, &call.tool_slug, &call.arguments, &account, false).await;
    }
    let need = policy::grant_need(&info, &call.arguments, &account, kind);
    let covering = need.clone();
    let covered = call.mode == "auto"
        && on_store(store, move |store| grants::covering_grant(store, &covering))
            .await
            .map_err(storage_failure)?;
    let hash = policy::arguments_hash(&call.tool_slug, &call.arguments, &account);
    if policy::decide(&call.mode, &need, covered) == Decision::Allow {
        let (subject, arguments_hash) = (info.slug.clone(), hash);
        on_store(store, move |store| {
            requests::use_matching(store, &subject, &arguments_hash)
        })
        .await
        .map_err(storage_failure)?;
        return run_tool(client, &call.tool_slug, &call.arguments, &account, true).await;
    }
    let Some((title, summary)) = policy::action_summary(&info, &call.arguments, &account) else {
        return Err(rejected(
            "question_too_long",
            crate::agents::run_control::tool_question::TOO_LONG,
        ));
    };
    let draft = Draft {
        run_id: call.run_id.clone(),
        kind: "approve",
        subject: info.slug.clone(),
        arguments_hash: hash,
        title: title.clone(),
        summary,
        permission_mode: if call.mode == "auto" { "auto" } else { "ask" }.to_owned(),
        grant: Remember::of(&need),
    };
    let request = on_store(store, move |store| requests::open(store, draft))
        .await
        .map_err(storage_failure)?;
    match request.state.as_str() {
        "approved" => {
            let id = request.id.clone();
            let used = on_store(store, move |store| {
                requests::resolve(store, &id, "approved", "used")
            })
            .await
            .map_err(storage_failure)?;
            if used.is_none() {
                return Err(rejected(
                    "invalid_request",
                    "That approval was already used. Call integration_execute again to ask the user again.",
                ));
            }
            run_tool(client, &call.tool_slug, &call.arguments, &account, true).await
        }
        "declined" => Err(rejected(
            "declined",
            format!(
                "The user declined “{title}”. Do not retry it; continue without it or ask the user."
            ),
        )),
        _ => Ok(Executed::Waiting {
            title,
            request: request.view(),
        }),
    }
}

/// Runs a tool and shapes its result for the model.
async fn run_tool(
    client: &Client,
    slug: &str,
    arguments: &Value,
    account: &str,
    write: bool,
) -> Result<Executed, Failure> {
    let execution = client
        .with_session(
            |session| async move { client.execute(&session, slug, arguments, account).await },
        )
        .await
        .map_err(|error| failure(error, write))?;
    let logged = |message: String| {
        if execution.log_id.is_empty() {
            message
        } else {
            format!("{message} (log {})", execution.log_id)
        }
    };
    // Each of these is an answer that the action didn't run or changed nothing.
    match execution.result_type.as_deref() {
        Some("blocked") => {
            let message = execution.message.as_deref().unwrap_or_default().trim();
            return Err(rejected(
                "apps_rejected",
                logged(if message.is_empty() {
                    "Composio blocked this tool call.".to_owned()
                } else {
                    truncate(message, 600)
                }),
            ));
        }
        Some("input_required") => {
            return Err(rejected(
                "apps_rejected",
                "This tool asked for more input than Misty can give it. Try another tool.",
            ));
        }
        _ => {}
    }
    let error = execution.error.as_deref().unwrap_or_default().trim();
    if !error.is_empty() {
        return Err(rejected("apps_rejected", logged(truncate(error, 600))));
    }
    if execution.result_type.as_deref() == Some("failed") {
        return Err(rejected(
            "apps_rejected",
            logged("The app reported that this failed.".to_owned()),
        ));
    }
    let data = execution.data.clone().unwrap_or(Value::Null);
    let text = data.to_string();
    let mut result = BTreeMap::from([("tool", json!(slug)), ("log_id", json!(execution.log_id))]);
    if text.len() <= RESULT_LIMIT {
        result.insert("data", data);
    } else {
        result.insert("data_preview", json!(truncate(&text, RESULT_LIMIT)));
        result.insert(
            "note",
            json!("The result is larger than Misty passes to the model. Narrow the request: fewer items, a date range or specific fields."),
        );
    }
    Ok(Executed::Done {
        result: json!(result),
    })
}
