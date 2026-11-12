//! What the agent tools ask for (`src/features/agents/localTools/appsTools.ts`), other than running a
//! tool (`execute`). The model sees the same answers the server gave it.
use serde::Serialize;
use serde_json::Value;

use super::AccountStore as Store;
use super::{
    api::{Account, SearchResult},
    apps::on_store,
    client::{Client, Error},
    requests::{self, Draft, RequestView},
};

/// Why a call didn't produce a result. `uncertain` means it may have taken effect.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Failure {
    pub code: String,
    pub message: String,
    pub uncertain: bool,
}

pub(super) fn rejected(code: &str, message: impl Into<String>) -> Failure {
    Failure {
        code: code.to_owned(),
        message: message.into(),
        uncertain: false,
    }
}

pub(super) const NOT_CONNECTED: &str = "No apps are connected on this computer. Use the app's web \
     page in the browser instead. The person can connect apps in Misty's Apps page.";

/// A Composio error as a call's answer. `Unavailable` and anything Composio refused had no effect;
/// the rest may have, which only matters for a write.
pub fn failure(error: Error, write: bool) -> Failure {
    match error {
        Error::Unavailable => rejected("apps_not_connected", NOT_CONNECTED),
        ref refused @ Error::Api { ref message, .. } if refused.rejected() => {
            rejected("apps_rejected", message.clone())
        }
        _ if write => Failure {
            code: "apps_uncertain".to_owned(),
            message: "The connected apps service didn't answer, so this may or may not have \
                      happened. Check before doing it again."
                .to_owned(),
            uncertain: true,
        },
        _ => rejected(
            "apps_unreachable",
            "Misty couldn't reach the connected apps service. Try again.",
        ),
    }
}

pub(super) fn storage_failure(message: String) -> Failure {
    rejected("apps_storage", message)
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ActiveAccount {
    pub app: String,
    pub account: String,
    pub alias: String,
    pub status: String,
}

fn active_accounts(accounts: Vec<Account>) -> Vec<ActiveAccount> {
    accounts
        .into_iter()
        .filter(Account::active)
        .map(|account| ActiveAccount {
            alias: account.alias().to_owned(),
            status: account.status.to_lowercase(),
            app: account.toolkit.slug,
            account: account.id,
        })
        .collect()
}

pub async fn connected(client: &Client) -> Result<Vec<ActiveAccount>, Failure> {
    let accounts = client
        .accounts("")
        .await
        .map_err(|error| failure(error, false))?;
    Ok(active_accounts(accounts))
}

#[derive(Debug, Serialize)]
pub struct Search {
    pub found: SearchResult,
    pub accounts: Vec<ActiveAccount>,
}

pub async fn search(client: &Client, queries: &[String]) -> Result<Search, Failure> {
    let found = client
        .with_session(|session| async move { client.search(&session, queries).await })
        .await
        .map_err(|error| failure(error, false))?;
    Ok(Search {
        found,
        accounts: connected(client).await?,
    })
}

pub async fn schemas(client: &Client, slugs: &[String]) -> Result<Value, Failure> {
    client
        .with_session(|session| async move { client.tool_schemas(&session, slugs).await })
        .await
        .map_err(|error| failure(error, false))
}

/// A Connect card's outcome: the app is ready, or here's the card to show.
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Connect {
    Connected,
    Card { name: String, request: RequestView },
}

/// The app's display name, or its slug when Composio has none.
async fn app_name(client: &Client, app: &str) -> String {
    let found = client
        .with_session(|session| async move { client.toolkits(&session, app, "", false).await })
        .await;
    found
        .ok()
        .and_then(|(items, _)| items.into_iter().find(|item| item.slug == app))
        .map(|item| item.name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| app.to_owned())
}

pub async fn connect(
    client: &Client,
    store: &Store,
    run_id: &str,
    app: &str,
) -> Result<Connect, Failure> {
    let accounts = client
        .accounts("")
        .await
        .map_err(|error| failure(error, false))?;
    if accounts
        .iter()
        .any(|item| item.toolkit.slug == app && item.active())
    {
        return Ok(Connect::Connected);
    }
    let name = app_name(client, app).await;
    let draft = Draft {
        run_id: run_id.to_owned(),
        kind: "connect",
        subject: app.to_owned(),
        arguments_hash: String::new(),
        title: format!("Connect {name}"),
        summary: format!("Sign in to {name} so Misty can continue."),
        permission_mode: String::new(),
        grant: None,
    };
    let request = on_store(store, move |store| requests::open(store, draft))
        .await
        .map_err(storage_failure)?;
    Ok(Connect::Card {
        name,
        request: request.view(),
    })
}
