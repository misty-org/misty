//! Every command the browser feature answers to the app windows. The code is in the modules that own it;
//! this lists them in one place for the command table. Glob re-exports carry the `__cmd__*` macros
//! that #[tauri::command] generates beside each function.

mod agent_pages;
mod app_windows;
mod history_downloads;
mod pages;
mod site_data;

pub(crate) use agent_pages::*;
pub(crate) use app_windows::*;
pub(crate) use history_downloads::*;
pub(crate) use pages::*;
pub(crate) use site_data::*;
