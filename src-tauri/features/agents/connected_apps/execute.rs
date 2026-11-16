//! Running one app tool. The decisions that must hold whatever the renderer does live here: which account
//! a call runs as, whether a write needs the person, and that one approval covers one exact action.
use serde::Serialize;
use serde_json::Value;

use super::AccountStore as Store;
use super::{
    apps::on_store,
    grants,
    policy::{self, Decision, Kind},
    requests::{self, Draft, Remember, RequestView},
    tools::{rejected, storage_failure, Failure},
};

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

/// What every app call goes through once its tool and account are known, wherever it runs: a read
/// runs at once; a write runs when the mode, a remembered approval or an answered card allows it,
/// and otherwise opens a card. `run` gets whether the call writes.
pub(super) async fn approve_and_run<F, Fut>(
    store: &Store,
    call: &ExecuteCall,
    info: &super::types::ToolInfo,
    account: &str,
    run: F,
) -> Result<Executed, Failure>
where
    F: Fn(bool) -> Fut,
    Fut: std::future::Future<Output = Result<Executed, Failure>>,
{
    let account = account.to_owned();
    let kind = policy::classify(&info.slug, &info.tags);
    if kind == Kind::Read {
        return run(false).await;
    }
    let need = policy::grant_need(info, &call.arguments, &account, kind);
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
        return run(true).await;
    }
    let Some((title, summary)) = policy::action_summary(info, &call.arguments, &account) else {
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
            run(true).await
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
