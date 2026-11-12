//! A direct connection's tools as agents see them: found by `integration_search`, listed by
//! `integration_connected` and run by `integration_execute`, beside Composio's and through the
//! same approval rules (`execute::approve_and_run`).
//!
//! A tool's slug is `MCP_<APP>_<TOOL>` in Composio's alphabet (`MCP_NOTION_NOTION_SEARCH`), so the
//! model and the handlers treat both kinds the same; the server's own tool name is looked up again
//! from the slug, never taken from the model.
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::super::execute::{approve_and_run, ExecuteCall, Executed};
use super::super::tools::{rejected, ActiveAccount, Failure};
use super::super::types::{SearchResult, SearchSchema, SearchTask, ToolInfo, ToolToolkit};
use super::super::AccountStore as Store;
use super::client::{self, CallError};
use super::oauth;
use super::store::{self, Connection};

pub const SLUG_PREFIX: &str = "MCP_";
/// A server's tool list is asked again after this long.
const TOOLS_KEPT: Duration = Duration::from_secs(10 * 60);
/// A token this close to expiring is refreshed first.
const REFRESH_EARLY: i64 = 60;
const RESULT_LIMIT: usize = 48 << 10;
const PRIMARY: usize = 6;

/// One tool of one connection.
#[derive(Clone, Debug)]
pub struct DirectTool {
    pub slug: String,
    pub name: String,
    pub title: String,
    pub description: String,
    pub input_schema: Value,
    pub read_only: bool,
    pub destructive: bool,
}

fn upper(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect()
}

pub fn slug_of(app: &str, tool: &str) -> String {
    let mut slug = format!("{SLUG_PREFIX}{}_{}", upper(app), upper(tool));
    slug.truncate(128);
    slug
}

pub fn is_direct(slug: &str) -> bool {
    slug.starts_with(SLUG_PREFIX)
}

pub fn tool_of(app: &str, tool: &Value) -> Option<DirectTool> {
    let name = tool["name"].as_str()?.to_owned();
    let hint = |key: &str| tool["annotations"][key].as_bool() == Some(true);
    Some(DirectTool {
        slug: slug_of(app, &name),
        title: tool["title"]
            .as_str()
            .or_else(|| tool["annotations"]["title"].as_str())
            .unwrap_or(&name)
            .to_owned(),
        description: tool["description"].as_str().unwrap_or_default().to_owned(),
        input_schema: tool["inputSchema"].clone(),
        read_only: hint("readOnlyHint"),
        destructive: hint("destructiveHint"),
        name,
    })
}

/// Each connection's tools and when they were listed.
type ToolCache = Mutex<HashMap<String, (Vec<DirectTool>, Instant)>>;

fn tool_cache() -> &'static ToolCache {
    static CACHE: std::sync::OnceLock<ToolCache> = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn http() -> Result<reqwest::Client, Failure> {
    crate::engine_config::support::http_client().map_err(|_| {
        rejected(
            "apps_unreachable",
            "Misty couldn't reach this app. Try again.",
        )
    })
}

fn storage(message: String) -> Failure {
    rejected("apps_storage", message)
}

pub async fn connections(account: &str) -> Result<Vec<Connection>, Failure> {
    let account = account.to_owned();
    store::blocking(move || store::list(&account))
        .await
        .map_err(storage)
}

/// A token for this connection that the app should still take, refreshed first when it is about
/// to run out.
async fn fresh_token(
    account: &str,
    connection: &Connection,
    force: bool,
) -> Result<String, Failure> {
    let near_end = connection
        .expires_at
        .is_some_and(|end| end - REFRESH_EARLY <= chrono::Utc::now().timestamp());
    if !force && !near_end {
        return Ok(connection.access_token.clone());
    }
    let Some(refresh_token) = connection.refresh_token.clone() else {
        return Err(signed_out(connection));
    };
    let tokens = oauth::refresh(
        &http()?,
        &connection.token_endpoint,
        &connection.client_id,
        connection.client_secret.as_deref(),
        &connection.resource,
        &refresh_token,
    )
    .await
    .map_err(|_| signed_out(connection))?;
    let (account, id, saved) = (account.to_owned(), connection.id.clone(), tokens.clone());
    store::blocking(move || {
        store::update(&account, |items| {
            if let Some(item) = items.iter_mut().find(|item| item.id == id) {
                item.access_token = saved.access_token.clone();
                item.expires_at = saved.expires_at;
                if saved.refresh_token.is_some() {
                    item.refresh_token = saved.refresh_token.clone();
                }
            }
        })
    })
    .await
    .map_err(storage)?;
    Ok(tokens.access_token)
}

fn signed_out(connection: &Connection) -> Failure {
    rejected(
        "apps_not_connected",
        format!(
            "The user's sign-in to {} has ended. Ask them to connect it again in Misty's Apps.",
            connection.name
        ),
    )
}

/// Runs `work` with a fresh token, refreshing once if the app turns it down.
async fn with_token<T, F, Fut>(
    account: &str,
    connection: &Connection,
    work: F,
) -> Result<T, Failure>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<T, CallError>>,
{
    let token = fresh_token(account, connection, false).await?;
    match work(token).await {
        Err(CallError::Unauthorized) => {
            let token = fresh_token(account, connection, true).await?;
            match work(token).await {
                Err(CallError::Unauthorized) => Err(signed_out(connection)),
                Err(CallError::Failed(message)) => Err(rejected("apps_rejected", message)),
                Ok(value) => Ok(value),
            }
        }
        Err(CallError::Failed(message)) => Err(rejected("apps_rejected", message)),
        Ok(value) => Ok(value),
    }
}

/// A connection's tools, from the cache while it is fresh.
pub async fn tools_of(account: &str, connection: &Connection) -> Result<Vec<DirectTool>, Failure> {
    if let Some((tools, at)) = tool_cache()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&connection.id)
        .cloned()
    {
        if at.elapsed() < TOOLS_KEPT {
            return Ok(tools);
        }
    }
    let http = http()?;
    let url = connection.url.clone();
    let listed = with_token(account, connection, |token| {
        let (http, url) = (http.clone(), url.clone());
        async move { client::tools(&http, &url, &token).await }
    })
    .await?;
    let tools: Vec<DirectTool> = listed
        .iter()
        .filter_map(|tool| tool_of(&connection.app, tool))
        .collect();
    tool_cache()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(connection.id.clone(), (tools.clone(), Instant::now()));
    Ok(tools)
}

pub fn forget_tools(connection_id: &str) {
    tool_cache()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(connection_id);
}

/// The connections as `integration_connected` lists them.
pub fn active(connections: &[Connection]) -> Vec<ActiveAccount> {
    connections
        .iter()
        .map(|item| ActiveAccount {
            app: item.app.clone(),
            account: item.id.clone(),
            alias: item.name.clone(),
            status: "active".to_owned(),
        })
        .collect()
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.len() > 2)
        .map(str::to_owned)
        .collect()
}

/// How well a tool fits a query: the query's words found in its app, name and description.
fn score(query: &[String], connection: &Connection, tool: &DirectTool) -> usize {
    let name = format!("{} {} {}", tool.name, tool.title, connection.app).to_lowercase();
    let description = tool.description.to_lowercase();
    query
        .iter()
        .map(|word| {
            if name.contains(word.as_str()) {
                3
            } else if description.contains(word.as_str()) {
                1
            } else {
                0
            }
        })
        .sum()
}

/// Adds the direct connections' tools that fit each query to Composio's answer (or to an empty
/// one when there is no Composio key).
pub async fn search_into(
    account: &str,
    queries: &[String],
    found: &mut SearchResult,
) -> Vec<ActiveAccount> {
    let Ok(list) = connections(account).await else {
        return Vec::new();
    };
    let mut every = Vec::new();
    for connection in &list {
        if let Ok(tools) = tools_of(account, connection).await {
            every.extend(tools.into_iter().map(|tool| (connection.clone(), tool)));
        }
    }
    for query in queries {
        let wanted = words(query);
        let mut ranked: Vec<(usize, &(Connection, DirectTool))> = every
            .iter()
            .map(|pair| (score(&wanted, &pair.0, &pair.1), pair))
            .filter(|(score, _)| *score > 0)
            .collect();
        ranked.sort_by(|a, b| b.0.cmp(&a.0));
        if ranked.is_empty() {
            continue;
        }
        let slugs: Vec<String> = ranked
            .iter()
            .map(|(_, (_, tool))| tool.slug.clone())
            .collect();
        let mut apps: Vec<String> = ranked
            .iter()
            .map(|(_, (item, _))| item.app.clone())
            .collect();
        apps.dedup();
        for (_, (connection, tool)) in ranked.iter().take(PRIMARY * 2) {
            found.tool_schemas.insert(
                tool.slug.clone(),
                SearchSchema {
                    toolkit: connection.app.clone(),
                    description: super::super::client::truncate(&tool.description, 600),
                    input_schema: Some(tool.input_schema.clone()),
                    has_full_schema: true,
                },
            );
        }
        found.results.push(SearchTask {
            use_case: query.clone(),
            execution_guidance: "These tools reach the user's app directly, signed in as them. \
                Run one with integration_execute and its exact slug."
                .to_owned(),
            primary_tool_slugs: slugs.iter().take(PRIMARY).cloned().collect(),
            related_tool_slugs: slugs.iter().skip(PRIMARY).take(PRIMARY).cloned().collect(),
            toolkits: apps,
            ..SearchTask::default()
        });
    }
    found.success = found.success || !found.results.is_empty();
    active(&list)
}

/// The full input schemas of direct tools named in `slugs`.
pub async fn schemas(account: &str, slugs: &[String]) -> BTreeMap<String, Value> {
    let mut out = BTreeMap::new();
    let Ok(list) = connections(account).await else {
        return out;
    };
    for connection in &list {
        let Ok(tools) = tools_of(account, connection).await else {
            continue;
        };
        for tool in tools.into_iter().filter(|tool| slugs.contains(&tool.slug)) {
            out.insert(
                tool.slug.clone(),
                json!({
                    "toolkit": connection.app,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                }),
            );
        }
    }
    out
}

/// The connection and tool a slug names, among this account's connections. `requested` picks one
/// connection when several have the tool.
async fn resolve(
    account: &str,
    slug: &str,
    requested: &str,
) -> Result<(Connection, DirectTool), Failure> {
    let list = connections(account).await?;
    let mut matches = Vec::new();
    for connection in &list {
        if !slug.starts_with(&format!("{SLUG_PREFIX}{}_", upper(&connection.app))) {
            continue;
        }
        if let Some(tool) = tools_of(account, connection)
            .await?
            .into_iter()
            .find(|tool| tool.slug == slug)
        {
            matches.push((connection.clone(), tool));
        }
    }
    let requested = requested.trim();
    if !requested.is_empty() {
        return matches
            .into_iter()
            .find(|(connection, _)| connection.id == requested)
            .ok_or_else(|| {
                rejected(
                    "invalid_request",
                    "That account isn't one of the user's for this app.",
                )
            });
    }
    match matches.len() {
        0 => Err(rejected(
            "invalid_request",
            format!("Unknown app tool {slug}. Use integration_search to find exact slugs."),
        )),
        1 => Ok(matches.remove(0)),
        _ => Err(rejected(
            "invalid_request",
            format!(
                "Several connections have this tool. Pass account as one of: {}.",
                matches
                    .iter()
                    .map(|(connection, _)| connection.id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        )),
    }
}

/// The model's view of a tool result: structured content when the app gave it, else its text.
fn shaped(slug: &str, result: &Value) -> Result<Value, Failure> {
    let text: Vec<String> = result["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| part["text"].as_str().map(str::to_owned))
        .collect();
    if result["isError"].as_bool() == Some(true) {
        let message = text.join("\n");
        return Err(rejected(
            "apps_rejected",
            if message.trim().is_empty() {
                "The app reported that this failed.".to_owned()
            } else {
                super::super::client::truncate(&message, 600)
            },
        ));
    }
    let data = match result.get("structuredContent") {
        Some(structured) if !structured.is_null() => structured.clone(),
        _ => json!(text.join("\n")),
    };
    let serialized = data.to_string();
    Ok(if serialized.len() <= RESULT_LIMIT {
        json!({ "tool": slug, "data": data })
    } else {
        json!({
            "tool": slug,
            "data_preview": super::super::client::truncate(&serialized, RESULT_LIMIT),
            "note": "The result is larger than Misty passes to the model. Narrow the request.",
        })
    })
}

/// Runs a direct tool through the same rules as a Composio one.
pub async fn execute(account: &str, store: &Store, call: ExecuteCall) -> Result<Executed, Failure> {
    let (connection, tool) = resolve(account, &call.tool_slug, &call.account).await?;
    let mut tags = Vec::new();
    if tool.read_only {
        tags.push("readOnlyHint".to_owned());
    }
    if tool.destructive {
        tags.push("destructiveHint".to_owned());
    }
    let info = ToolInfo {
        slug: format!("{}_{}", upper(&connection.app), upper(&tool.name)),
        name: tool.title.clone(),
        tags,
        toolkit: ToolToolkit {
            slug: connection.app.clone(),
            name: connection.name.clone(),
        },
    };
    let http = http()?;
    let (connection_ref, tool_ref, http_ref) = (&connection, &tool, &http);
    let arguments = call.arguments.clone();
    let arguments_ref = &arguments;
    let slug = call.tool_slug.clone();
    let slug_ref = &slug;
    approve_and_run(
        store,
        &call,
        &info,
        &connection.id,
        move |_write| async move {
            let result = with_token(account, connection_ref, |token| {
                let url = connection_ref.url.clone();
                let name = tool_ref.name.clone();
                async move { client::call(http_ref, &url, &token, &name, arguments_ref).await }
            })
            .await?;
            Ok(Executed::Done {
                result: shaped(slug_ref, &result)?,
            })
        },
    )
    .await
}
