//! Browser commands for site data, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

pub(crate) use crate::browser::link_previews::{
    __cmd__link_preview_fetch, __tauri_command_name_link_preview_fetch, link_preview_fetch,
};
pub(crate) use crate::browser::profiles::{
    __cmd__profile_tabs_publish, __cmd__profile_tabs_sync,
    __tauri_command_name_profile_tabs_publish, __tauri_command_name_profile_tabs_sync,
    profile_tabs_publish, profile_tabs_sync,
};
pub(crate) use crate::browser::site_icons::{
    __cmd__browser_site_icon, __tauri_command_name_browser_site_icon, browser_site_icon,
};
