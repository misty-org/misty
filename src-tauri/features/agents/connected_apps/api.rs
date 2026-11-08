//! The Composio calls Misty makes.
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use super::client::{truncate, Client, Error};
pub use super::types::*;

const TOOL_CACHE: Duration = Duration::from_secs(30 * 60);
const ACCOUNT_PAGES: usize = 5;

fn all_chars(value: &str, extra: &[char]) -> bool {
    value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || extra.contains(&character))
}

pub fn valid_session(id: &str) -> bool {
    (4..=160).contains(&id.len()) && all_chars(id, &['_', '-'])
}

pub fn valid_account(id: &str) -> bool {
    (1..=160).contains(&id.len()) && all_chars(id, &['_', '-'])
}

/// `GMAIL_SEND_EMAIL`
pub fn valid_tool_slug(slug: &str) -> bool {
    (3..=128).contains(&slug.len())
        && slug.starts_with(|character: char| character.is_ascii_uppercase())
        && slug
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// `googledrive`
pub fn valid_toolkit(slug: &str) -> bool {
    (2..=64).contains(&slug.len())
        && slug.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

fn session_path(session: &str, operation: &str) -> String {
    format!(
        "tool_router/session/{}/{operation}",
        url::form_urlencoded::byte_serialize(session.as_bytes()).collect::<String>()
    )
}

fn fail_message(error: &str) -> String {
    truncate(error.trim(), 400)
}

/// Keeps sign-in links on Composio's own HTTPS domain.
pub fn connect_link_allowed(raw: &str) -> bool {
    let Ok(link) = url::Url::parse(raw) else {
        return false;
    };
    if link.scheme() != "https"
        || !link.username().is_empty()
        || link.password().is_some()
        || link.port().is_some()
    {
        return false;
    }
    let host = link.host_str().unwrap_or_default().to_lowercase();
    host == "composio.dev" || host.ends_with(".composio.dev")
}

impl Client {
    /// Finds tools for plain-language use cases across every toolkit.
    pub async fn search(&self, session: &str, use_cases: &[String]) -> Result<SearchResult, Error> {
        let queries: Vec<Value> = use_cases
            .iter()
            .map(|use_case| json!({ "use_case": use_case }))
            .collect();
        let found: SearchResult = self
            .post(
                &session_path(session, "search"),
                &json!({ "queries": queries }),
            )
            .await?;
        match found
            .error
            .as_deref()
            .filter(|error| !error.trim().is_empty())
        {
            Some(error) if !found.success => Err(Error::Api {
                status: 422,
                message: fail_message(error),
            }),
            _ => Ok(found),
        }
    }

    /// Full input schemas for exact tool slugs.
    pub async fn tool_schemas(&self, session: &str, slugs: &[String]) -> Result<Value, Error> {
        let out: Execution = self
            .post(
                &session_path(session, "execute_meta"),
                &json!({
                    "slug": "COMPOSIO_GET_TOOL_SCHEMAS",
                    "arguments": { "tool_slugs": slugs, "include": ["input_schema"] },
                }),
            )
            .await?;
        if let Some(error) = out
            .error
            .as_deref()
            .filter(|error| !error.trim().is_empty())
        {
            return Err(Error::Api {
                status: 422,
                message: fail_message(error),
            });
        }
        Ok(out.data.unwrap_or(Value::Null))
    }

    /// Runs one tool as one named account.
    pub async fn execute(
        &self,
        session: &str,
        slug: &str,
        arguments: &Value,
        account: &str,
    ) -> Result<Execution, Error> {
        let mut body = json!({ "tool_slug": slug, "arguments": arguments });
        if !account.is_empty() {
            body["account"] = json!(account);
        }
        self.post(&session_path(session, "execute"), &body).await
    }

    /// Starts sign-in for one toolkit and returns Composio's Connect Link.
    pub async fn link(&self, session: &str, toolkit: &str) -> Result<String, Error> {
        #[derive(Deserialize)]
        struct Linked {
            #[serde(default)]
            redirect_url: String,
        }
        let linked: Linked = self
            .post(
                &session_path(session, "link"),
                &json!({ "toolkit": toolkit }),
            )
            .await?;
        if !connect_link_allowed(&linked.redirect_url) {
            return Err(Error::bad_gateway(
                "Composio returned a sign-in link outside composio.dev.",
            ));
        }
        Ok(linked.redirect_url)
    }

    /// One page of the app catalog, optionally by text or only what's connected.
    pub async fn toolkits(
        &self,
        session: &str,
        search: &str,
        cursor: &str,
        connected_only: bool,
    ) -> Result<(Vec<Toolkit>, String), Error> {
        let mut query = vec![("limit", if connected_only { "50" } else { "30" })];
        if connected_only {
            query.push(("is_connected", "true"));
        }
        if !search.trim().is_empty() {
            query.push(("search", search.trim()));
        }
        if !cursor.is_empty() {
            query.push(("cursor", cursor));
        }
        let page: Page<Toolkit> = self.get(&session_path(session, "toolkits"), &query).await?;
        Ok((page.items, page.next_cursor.unwrap_or_default()))
    }

    /// This computer's connected accounts, optionally for one toolkit. Items for any other user are
    /// dropped even if Composio returns them.
    pub async fn accounts(&self, toolkit: &str) -> Result<Vec<Account>, Error> {
        let user = self.user().to_owned();
        let mut items = Vec::new();
        let mut cursor = String::new();
        for _ in 0..ACCOUNT_PAGES {
            let mut query = vec![("user_ids", user.as_str()), ("limit", "100")];
            if !toolkit.is_empty() {
                query.push(("toolkit_slugs", toolkit));
            }
            if !cursor.is_empty() {
                query.push(("cursor", cursor.as_str()));
            }
            let page: Page<Account> = self.get("connected_accounts", &query).await?;
            items.extend(page.items.into_iter().filter(|item| {
                item.user_id == user && (toolkit.is_empty() || item.toolkit.slug == toolkit)
            }));
            cursor = page.next_cursor.unwrap_or_default();
            if cursor.is_empty() {
                break;
            }
        }
        Ok(items)
    }

    /// Removes a connected account after confirming it's this computer's.
    pub async fn delete_account(&self, id: &str) -> Result<(), Error> {
        let missing = || Error::Api {
            status: 404,
            message: "That connection does not exist.".to_owned(),
        };
        if !valid_account(id) {
            return Err(missing());
        }
        let account: Account = self.get(&format!("connected_accounts/{id}"), &[]).await?;
        if account.id != id || account.user_id != self.user() {
            return Err(missing());
        }
        self.delete(&format!("connected_accounts/{id}")).await
    }

    /// A tool's tags, kept a while since they rarely change.
    pub async fn tool(&self, slug: &str) -> Result<ToolInfo, Error> {
        let missing = || Error::Api {
            status: 404,
            message: "Unknown tool slug.".to_owned(),
        };
        if !valid_tool_slug(slug) {
            return Err(missing());
        }
        if let Some((info, at)) = self
            .tools
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(slug)
        {
            if at.elapsed() < TOOL_CACHE {
                return Ok(info.clone());
            }
        }
        let info: ToolInfo = self.get(&format!("tools/{slug}"), &[]).await?;
        if info.slug != slug {
            return Err(missing());
        }
        self.tools
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(slug.to_owned(), (info.clone(), Instant::now()));
        Ok(info)
    }
}
