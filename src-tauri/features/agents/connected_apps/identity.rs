//! Who a connection signed in as, for the accounts popup: Composio's display name, or a read-only
//! call for apps whose connection carries none.
use std::{collections::HashMap, sync::PoisonError};

use futures_util::future::join_all;
use serde_json::{json, Value};

use super::{
    api::Account,
    client::{truncate, Client},
};

struct IdentityTool {
    slug: &'static str,
    arguments: fn() -> Value,
    field: &'static str,
}

fn identity_tool(toolkit: &str) -> Option<IdentityTool> {
    match toolkit {
        "discord" => Some(IdentityTool {
            slug: "DISCORD_GET_MY_USER",
            arguments: || json!({}),
            field: "username",
        }),
        // Calendar is granted events only; the primary calendar's summary is the owner's email.
        "googlecalendar" => Some(IdentityTool {
            slug: "GOOGLECALENDAR_EVENTS_LIST",
            arguments: || json!({ "calendarId": "primary", "maxResults": 1 }),
            field: "summary",
        }),
        _ => None,
    }
}

impl Client {
    /// Names each connection it can, by account ID. A failed lookup is left out and tried next time.
    pub async fn identities(&self, session: &str, accounts: &[Account]) -> HashMap<String, String> {
        let mut names = HashMap::new();
        let mut lookups = Vec::new();
        for account in accounts {
            let display = account
                .state
                .val
                .display_name
                .as_deref()
                .unwrap_or_default();
            if !display.trim().is_empty() {
                names.insert(account.id.clone(), truncate(display.trim(), 120));
                continue;
            }
            let cached = self
                .identities
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(&account.id)
                .cloned();
            if let Some(cached) = cached {
                names.insert(account.id.clone(), cached);
                continue;
            }
            if let Some(tool) = identity_tool(&account.toolkit.slug).filter(|_| account.active()) {
                lookups.push(self.identity(session, account.id.clone(), tool));
            }
        }
        for (id, name) in join_all(lookups).await.into_iter().flatten() {
            names.insert(id, name);
        }
        names
    }

    async fn identity(
        &self,
        session: &str,
        id: String,
        tool: IdentityTool,
    ) -> Option<(String, String)> {
        let out = self
            .execute(session, tool.slug, &(tool.arguments)(), &id)
            .await
            .ok()?;
        if out
            .error
            .as_deref()
            .is_some_and(|error| !error.trim().is_empty())
        {
            return None;
        }
        let name = truncate(out.data?.get(tool.field)?.as_str()?.trim(), 120);
        if name.is_empty() {
            return None;
        }
        self.identities
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.clone(), name.clone());
        Some((id, name))
    }
}
