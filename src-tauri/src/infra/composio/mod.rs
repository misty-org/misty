//! Connected apps on this computer, on the person's own Composio key.
//! The key lives in the credential store with the model keys and only this module reads it: it never
//! reaches the renderer, the agent runtime's model document or a Misty server. Composio's user is a
//! random ID made once per Misty account on this computer, with signed-out use on one of its own, so
//! one person's connections and remembered approvals never serve another, and Composio learns nothing
//! about the account.
pub mod api;
pub mod apps;
pub mod client;
pub mod commands;
pub mod execute;
pub mod grants;
mod identity;
pub mod policy;
mod request_view;
pub mod requests;
pub mod tools;
mod types;

#[cfg(test)]
mod apps_tests;
#[cfg(test)]
mod execute_tests;
#[cfg(test)]
mod tests;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, PoisonError},
};

use client::{Client, Error};

use crate::infra::{
    agent_runtime::windows::account_of_window,
    models::{header::COMPOSIO_KEY, KEY_SERVICE},
};

const SERVICE: &str = "com.misty.composio";
const USER_ENTRY: &str = "computer_user";

/// The account agents run under signed out.
pub(crate) const SIGNED_OUT: &str = "local";
/// What was asked and remembered signed out, from before each account had its own.
const SIGNED_OUT_ROWS: &str = "this_computer";

/// Whose connections a call acts on: the run's account for a tool, the window's for a person's page.
pub(crate) fn window_account(label: &str) -> String {
    account_of_window(label).filter(|account| !account.is_empty()).unwrap_or_else(|| SIGNED_OUT.to_owned())
}

/// `misty.db`, as one account sees its app requests and remembered approvals.
#[derive(Clone)]
pub struct AccountStore {
    store: crate::infra::store::Store,
    account: String,
}

impl AccountStore {
    pub fn new(store: crate::infra::store::Store, account: &str) -> Self {
        let account = if account.is_empty() || account == SIGNED_OUT { SIGNED_OUT_ROWS } else { account };
        Self { store, account: account.to_owned() }
    }

    pub(crate) fn account(&self) -> &str {
        &self.account
    }

    pub(crate) fn connect(&self) -> rusqlite::Result<rusqlite::Connection> {
        self.store.connect()
    }
}

/// Kept per account while the key stays the same. A new key is another Composio project, with another
/// session.
fn clients() -> &'static Mutex<HashMap<String, Arc<Client>>> {
    static CLIENTS: OnceLock<Mutex<HashMap<String, Arc<Client>>>> = OnceLock::new();
    CLIENTS.get_or_init(Default::default)
}

fn unreadable() -> Error {
    Error::Api {
        status: 500,
        message: "Misty couldn't read this computer's Composio key.".to_owned(),
    }
}

/// Where an account's Composio user is kept. Signed out keeps the entry the computer always had.
fn user_entry(account: &str) -> String {
    if account.is_empty() || account == SIGNED_OUT {
        USER_ENTRY.to_owned()
    } else {
        format!("account_user:{account}")
    }
}

/// This account's Composio user, made once and kept for good.
fn account_user(account: &str) -> Result<String, Error> {
    use crate::infra::credential_store as credentials;
    let entry = user_entry(account);
    if let Some(user) = credentials::load(SERVICE, &entry)
        .map_err(|_| unreadable())?
        .filter(|user| !user.is_empty())
    {
        return Ok(user);
    }
    let user = format!("misty_{}", uuid::Uuid::new_v4().simple());
    credentials::store(SERVICE, &entry, &user).map_err(|_| unreadable())?;
    Ok(user)
}

fn load(account: &str) -> Result<Arc<Client>, Error> {
    let key = crate::infra::credential_store::load(KEY_SERVICE, COMPOSIO_KEY)
        .map_err(|_| unreadable())?
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())
        .ok_or(Error::Unavailable)?;
    let entry = user_entry(account);
    let mut clients = clients().lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(client) = clients.get(&entry).filter(|client| client.holds_key(&key)) {
        return Ok(client.clone());
    }
    let client = Arc::new(Client::new(key, account_user(account)?));
    clients.insert(entry, client.clone());
    Ok(client)
}

/// The client for the key saved on this computer, as this account's user. `Unavailable` when there is
/// no key.
pub async fn account_client(account: &str) -> Result<Arc<Client>, Error> {
    let account = account.to_owned();
    tokio::task::spawn_blocking(move || load(&account))
        .await
        .map_err(|_| unreadable())?
}
