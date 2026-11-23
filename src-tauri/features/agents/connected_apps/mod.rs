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

pub(crate) const SIGNED_OUT: &str = "local";
const SIGNED_OUT_ROWS: &str = "this_computer";

pub(crate) fn window_account(label: &str) -> String {
    account_of_window(label)
        .filter(|account| !account.is_empty())
        .unwrap_or_else(|| SIGNED_OUT.to_owned())
}

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
