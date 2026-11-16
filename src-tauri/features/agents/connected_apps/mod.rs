//! Connected apps on this computer: apps whose makers run their own MCP server, which the person signs
//! in to directly (`direct`), with no key of Misty's and no middleman. Each Misty account on this
//! computer keeps its own connections, app requests and remembered approvals, so one person's never
//! serve another.
pub mod api;
pub mod apps;
pub mod commands;
pub mod direct;
pub mod execute;
pub mod grants;
pub mod policy;
mod request_view;
pub mod requests;
pub(crate) mod text;
pub mod tools;
mod types;

#[cfg(test)]
mod tests;

use crate::agents::run_control::windows::account_of_window;

/// The account agents run under signed out.
pub(crate) const SIGNED_OUT: &str = "local";
/// What was asked and remembered signed out, from before each account had its own.
const SIGNED_OUT_ROWS: &str = "this_computer";

/// Whose connections a call acts on: the run's account for a tool, the window's for a person's page.
pub(crate) fn window_account(label: &str) -> String {
    account_of_window(label)
        .filter(|account| !account.is_empty())
        .unwrap_or_else(|| SIGNED_OUT.to_owned())
}

/// `misty.db`, as one account sees its app requests and remembered approvals.
#[derive(Clone)]
pub struct AccountStore {
    store: database::store::Store,
    account: String,
}

impl AccountStore {
    pub fn new(store: database::store::Store, account: &str) -> Self {
        let account = if account.is_empty() || account == SIGNED_OUT {
            SIGNED_OUT_ROWS
        } else {
            account
        };
        Self {
            store,
            account: account.to_owned(),
        }
    }

    pub(crate) fn account(&self) -> &str {
        &self.account
    }

    pub(crate) fn connect(&self) -> rusqlite::Result<rusqlite::Connection> {
        self.store.connect()
    }
}
