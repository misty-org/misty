//! The native commands behind connected apps. Only a person's window may call them.
use serde_json::{json, Value};
use tauri::Manager;

use super::{
    apps::{self, on_store},
    execute, grants, requests,
    tools::{self, rejected, Failure},
    AccountStore,
};
use crate::app::runtime::MistyRuntime;
use database::store::Store;

/// What a remembered approval is held by in the app's list, where the server's are held by an agent.
const THIS_COMPUTER: &str = "this_computer";

/// The account this window is signed in as, whose connections its pages show.
fn person(webview: &tauri::Webview) -> Result<String, Failure> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(super::window_account(webview.label()))
    } else {
        Err(rejected(
            "not_allowed",
            "Only a profile's window can use connected apps.",
        ))
    }
}

/// The run's account for a tool call, the window's for a person's own page.
async fn account_for(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    run_id: Option<&str>,
) -> Result<String, Failure> {
    let window = person(webview)?;
    let Some(run_id) = run_id else {
        return Ok(window);
    };
    Ok(
        crate::agents::run_control::tool_gate::facts_of_run(app, run_id)
            .await
            .account,
    )
}

fn device_store(app: &tauri::AppHandle) -> Store {
    app.state::<MistyRuntime>().environment.store()
}

fn store(app: &tauri::AppHandle, account: &str) -> AccountStore {
    AccountStore::new(device_store(app), account)
}

fn missing_request() -> Failure {
    rejected("not_found", "That request does not exist.")
}

/// A card's current state.
#[tauri::command]
pub async fn apps_request_get(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
    run_id: Option<String>,
) -> Result<Value, Failure> {
    let account = account_for(&app, &webview, run_id.as_deref()).await?;
    let request = apps::current_request(&store(&app, &account), &id)
        .await
        .map_err(|message| rejected("apps_storage", message))?
        .ok_or_else(missing_request)?;
    Ok(json!({ "request": request.view() }))
}

/// Records the person's answer to a card.
#[tauri::command]
pub async fn apps_request_decide(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
    decision: String,
) -> Result<Value, Failure> {
    let account = person(&webview)?;
    let request = on_store(&store(&app, &account), move |store| {
        requests::decide(store, &id, &decision)
    })
    .await
    .map_err(|message| rejected("request_stale", message))?;
    Ok(json!({ "request": request.view() }))
}

/// The remembered approvals, in the shape of the server's list.
#[tauri::command]
pub async fn apps_grants_list(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Value, Failure> {
    let account = person(&webview)?;
    let grants = on_store(&store(&app, &account), grants::grants)
        .await
        .map_err(|message| rejected("apps_storage", message))?;
    let moment = |at: i64| {
        chrono::DateTime::from_timestamp_millis(at)
            .unwrap_or_default()
            .to_rfc3339()
    };
    let items: Vec<Value> = grants
        .iter()
        .map(|grant| {
            let mut label = grant.label.clone();
            if let Some(first) = label.get_mut(0..1) {
                first.make_ascii_uppercase();
            }
            let mut item = json!({
                "id": grant.id,
                "agent_id": THIS_COMPUTER,
                "agent_name": "All agents",
                "action": grant.action,
                "scope_kind": grant.scope_kind,
                "scope_id": grant.scope_id,
                "label": label,
                "created_at": moment(grant.created_at),
                "use_count": grant.use_count,
            });
            if let Some(used) = grant.last_used_at {
                item["last_used_at"] = json!(moment(used));
            }
            item
        })
        .collect();
    Ok(json!({ "grants": items }))
}

/// Forgets one remembered approval, or all of them with no `id`.
#[tauri::command]
pub async fn apps_grants_revoke(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: Option<String>,
) -> Result<(), Failure> {
    let account = person(&webview)?;
    on_store(&store(&app, &account), move |store| {
        grants::revoke_grants(store, id.as_deref())
    })
    .await
    .map_err(|message| rejected("apps_storage", message))
}

#[tauri::command]
pub async fn apps_tool_search(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    run_id: String,
    queries: Vec<String>,
) -> Result<tools::Search, Failure> {
    let account = account_for(&app, &webview, Some(&run_id)).await?;
    let mut found = tools::Search {
        found: Default::default(),
        accounts: Vec::new(),
    };
    let direct = super::direct::tools::search_into(&account, &queries, &mut found.found).await;
    found.accounts.extend(direct);
    if found.found.results.is_empty() && found.accounts.is_empty() {
        return Err(rejected("apps_not_connected", tools::NOT_CONNECTED));
    }
    Ok(found)
}

#[tauri::command]
pub async fn apps_tool_schemas(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    run_id: String,
    tool_slugs: Vec<String>,
) -> Result<Value, Failure> {
    let account = account_for(&app, &webview, Some(&run_id)).await?;
    let direct: Vec<String> = tool_slugs
        .into_iter()
        .filter(|slug| super::direct::tools::is_direct(slug))
        .collect();
    let mut schemas = json!({});
    if !direct.is_empty() {
        let found = super::direct::tools::schemas(&account, &direct).await;
        if let Some(map) = schemas.as_object_mut() {
            map.insert("direct_tool_schemas".to_owned(), json!(found));
        }
    }
    Ok(schemas)
}

#[tauri::command]
pub async fn apps_tool_connected(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    run_id: String,
) -> Result<Vec<tools::ActiveAccount>, Failure> {
    let account = account_for(&app, &webview, Some(&run_id)).await?;
    let direct = super::direct::tools::connections(&account).await?;
    Ok(super::direct::tools::active(&direct))
}

#[tauri::command]
pub async fn apps_tool_execute(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    run_id: String,
    tool_slug: String,
    arguments: Value,
    account: String,
) -> Result<execute::Executed, Failure> {
    person(&webview)?;
    let account_choice = account.clone();
    // The run's frozen mode, as it was started, however the chat has changed since. "Ask before acting"
    // can only make it stricter, and a setting that can't be read counts as asking.
    let facts = crate::agents::run_control::tool_gate::facts_of_run(&app, &run_id).await;
    let settings = crate::agents::run_control::tool_gate::agent_settings(&device_store(&app));
    let mode = mode_of(
        facts.auto,
        settings.app_actions_ask,
        settings.site_blocks.is_some(),
    );
    if !super::direct::tools::is_direct(&tool_slug) {
        return Err(rejected(
            "invalid_request",
            format!("Unknown app tool {tool_slug}. Use integration_search to find exact slugs."),
        ));
    }
    let account = facts.account.clone();
    super::direct::tools::execute(
        &account,
        &store(&app, &facts.account),
        execute::ExecuteCall {
            run_id,
            tool_slug,
            arguments,
            account: account_choice,
            mode: mode.to_owned(),
        },
    )
    .await
}

fn mode_of(auto: bool, actions_ask: bool, settings_read: bool) -> &'static str {
    if auto && !actions_ask && settings_read {
        "auto"
    } else {
        "ask"
    }
}

/// Shows a card in its run's chat, from what native code holds: a window can't make one up.
#[tauri::command]
pub async fn apps_request_show(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    run_id: String,
    id: String,
) -> Result<(), Failure> {
    let account = account_for(&app, &webview, Some(&run_id)).await?;
    let owned = run_id.clone();
    let request = on_store(&store(&app, &account), move |store| {
        requests::get(store, &id)
    })
    .await
    .map_err(|message| rejected("apps_storage", message))?
    .filter(|request| request.run_id == owned)
    .ok_or_else(missing_request)?;
    let event = json!({
        "id": format!("app-request-{}-{}", request.id, request.state),
        "type": "app.request",
        "appRequest": request.view(),
    });
    crate::agents::run_control::local_runs::publish_native(&app, &run_id, &event);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::mode_of;

    #[test]
    fn the_runs_mode_decides_and_settings_only_make_it_stricter() {
        assert_eq!(mode_of(true, false, true), "auto");
        assert_eq!(mode_of(false, false, true), "ask");
        assert_eq!(mode_of(true, true, true), "ask");
        assert_eq!(mode_of(true, false, false), "ask");
    }
}
