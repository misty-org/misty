//! The connected apps page: what's connected, the catalog, sign-in links and the app cards' answers.
use chrono::DateTime;
use serde::Serialize;

use super::AccountStore as Store;
use super::{
    api::{valid_toolkit, Account},
    client::{truncate, Client, Error},
    requests::{self, Request},
};

/// An unfinished sign-in stays listed this long. Each link starts a new account, so closed browser
/// tabs leave these behind.
const ABANDONED_SIGN_IN_SECS: i64 = 15 * 60;

#[derive(Debug, PartialEq, Serialize)]
pub struct ConnectedApp {
    pub id: String,
    pub app: String,
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub alias: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub account: String,
    pub status: &'static str,
    pub created_at: String,
    /// Composio's logo for the app; native code fetches it, so the page never loads it itself.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub logo: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct CatalogApp {
    pub app: String,
    pub name: String,
    pub description: String,
    pub connected: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub logo: String,
}

/// A logo address worth fetching: `https` and of a sane length, else none.
fn logo_url(value: &str) -> String {
    let value = value.trim();
    if value.starts_with("https://") && value.len() <= 2048 {
        value.to_owned()
    } else {
        String::new()
    }
}

/// `None` hides an abandoned sign-in.
fn status_of(account: &Account, now: i64) -> Option<&'static str> {
    if account.active() {
        return Some("active");
    }
    if matches!(account.status.as_str(), "INITIATED" | "INITIALIZING") {
        let started = DateTime::parse_from_rfc3339(&account.created_at).ok();
        if started.is_some_and(|started| now - started.timestamp() > ABANDONED_SIGN_IN_SECS) {
            return None;
        }
        return Some("pending");
    }
    Some("needs_attention")
}

pub async fn connected_apps(client: &Client) -> Result<Vec<ConnectedApp>, Error> {
    let (toolkits, accounts, identities) = client
        .with_session(|session| async move {
            let (toolkits, _) = client.toolkits(&session, "", "", true).await?;
            let accounts = client.accounts("").await?;
            let identities = client.identities(&session, &accounts).await;
            Ok((toolkits, accounts, identities))
        })
        .await?;
    let now = chrono::Utc::now().timestamp();
    let mut apps: Vec<ConnectedApp> = accounts
        .iter()
        .filter_map(|account| {
            let status = status_of(account, now)?;
            let toolkit = toolkits
                .iter()
                .find(|toolkit| toolkit.slug == account.toolkit.slug);
            let name = toolkit.map_or(account.toolkit.slug.clone(), |toolkit| toolkit.name.clone());
            let logo = toolkit
                .map(|toolkit| logo_url(&toolkit.meta.logo))
                .unwrap_or_default();
            Some(ConnectedApp {
                id: account.id.clone(),
                app: account.toolkit.slug.clone(),
                name,
                alias: account.alias().to_owned(),
                account: identities.get(&account.id).cloned().unwrap_or_default(),
                status,
                created_at: account.created_at.clone(),
                logo,
            })
        })
        .collect();
    apps.sort_by_key(|app| app.name.to_lowercase());
    Ok(apps)
}

/// Every app a person can connect.
pub async fn catalog(
    client: &Client,
    search: &str,
    cursor: &str,
) -> Result<(Vec<CatalogApp>, String), Error> {
    let search = search.trim();
    if search.len() > 100 || cursor.len() > 500 {
        return Err(Error::Api {
            status: 400,
            message: "That search is too long.".to_owned(),
        });
    }
    let (items, next) = client
        .with_session(
            |session| async move { client.toolkits(&session, search, cursor, false).await },
        )
        .await?;
    let apps = items
        .into_iter()
        .map(|item| CatalogApp {
            connected: item.connected_account.is_some(),
            description: truncate(&item.meta.description, 240),
            logo: logo_url(&item.meta.logo),
            app: item.slug,
            name: item.name,
        })
        .collect();
    Ok((apps, next))
}

/// A sign-in link for one app.
pub async fn sign_in_link(client: &Client, app: &str) -> Result<String, Error> {
    if !valid_toolkit(app) {
        return Err(Error::Api {
            status: 400,
            message: "That isn't an app Misty knows.".to_owned(),
        });
    }
    client
        .with_session(|session| async move { client.link(&session, app).await })
        .await
}

pub(super) async fn account_active(client: &Client, app: &str) -> Result<bool, Error> {
    Ok(client.accounts(app).await?.iter().any(Account::active))
}

pub(super) async fn on_store<T: Send + 'static>(
    store: &Store,
    work: impl FnOnce(&Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let store = store.clone();
    tokio::task::spawn_blocking(move || work(&store))
        .await
        .map_err(|_| "Misty couldn't read this computer's app requests.".to_owned())?
}

/// A card as it stands now. A pending Connect card is done once the app has an account, so a card left
/// after its run ended can still continue the chat. No key or no answer leaves it as it was.
pub async fn current_request(
    store: &Store,
    client: Option<&Client>,
    id: &str,
) -> Result<Option<Request>, String> {
    let owned = id.to_owned();
    let Some(request) = on_store(store, move |store| requests::get(store, &owned)).await? else {
        return Ok(None);
    };
    if request.kind != "connect" || request.state != "pending" {
        return Ok(Some(request));
    }
    let Some(client) = client else {
        return Ok(Some(request));
    };
    if !account_active(client, &request.subject)
        .await
        .unwrap_or(false)
    {
        return Ok(Some(request));
    }
    let owned = id.to_owned();
    let resolved = on_store(store, move |store| {
        requests::resolve(store, &owned, "pending", "connected")
    })
    .await?;
    Ok(Some(resolved.unwrap_or(request)))
}
