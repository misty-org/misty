//! Browser commands for site data, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

pub(crate) use crate::browser::default_browser::{
    __cmd__app_take_launch_urls, __tauri_command_name_app_take_launch_urls, app_take_launch_urls,
};
pub(crate) use crate::browser::link_previews::{
    __cmd__link_preview_fetch, __tauri_command_name_link_preview_fetch, link_preview_fetch,
};
pub(crate) use crate::browser::profiles::{
    __cmd__profile_records_list, __cmd__profile_records_write, __cmd__profile_tabs_publish,
    __cmd__profile_tabs_sync, __tauri_command_name_profile_records_list,
    __tauri_command_name_profile_records_write, __tauri_command_name_profile_tabs_publish,
    __tauri_command_name_profile_tabs_sync, profile_records_list, profile_records_write,
    profile_tabs_publish, profile_tabs_sync,
};
pub(crate) use crate::browser::search::profile::{
    __cmd__browser_profile_search, __tauri_command_name_browser_profile_search,
    browser_profile_search,
};
pub(crate) use crate::browser::search::suggest::{
    __cmd__browser_search_suggest, __tauri_command_name_browser_search_suggest,
    browser_search_suggest,
};
#[cfg(desktop)]
pub(crate) use crate::browser::site_data::retired_profiles::{
    __cmd__browser_retired_profiles_erase, __tauri_command_name_browser_retired_profiles_erase,
    browser_retired_profiles_erase,
};
pub(crate) use crate::browser::site_icons::{
    __cmd__browser_site_icon, __tauri_command_name_browser_site_icon, browser_site_icon,
};
#[cfg(desktop)]
pub(crate) use crate::browser::site_settings::permissions::{
    __cmd__browser_site_info, __cmd__browser_site_permission_answer,
    __cmd__browser_site_permissions_list, __cmd__browser_site_permissions_reset,
    __cmd__browser_site_permissions_set, __tauri_command_name_browser_site_info,
    __tauri_command_name_browser_site_permission_answer,
    __tauri_command_name_browser_site_permissions_list,
    __tauri_command_name_browser_site_permissions_reset,
    __tauri_command_name_browser_site_permissions_set, browser_site_info,
    browser_site_permission_answer, browser_site_permissions_list, browser_site_permissions_reset,
    browser_site_permissions_set,
};
#[cfg(any(all(desktop, desktop), desktop))]
pub(crate) use crate::browser::site_settings::style::{
    __cmd__browser_set_mouse_gestures, __cmd__browser_set_site_styles,
    __cmd__browser_webview_pick_element, __tauri_command_name_browser_set_mouse_gestures,
    __tauri_command_name_browser_set_site_styles,
    __tauri_command_name_browser_webview_pick_element, browser_set_mouse_gestures,
    browser_set_site_styles, browser_webview_pick_element,
};
#[cfg(desktop)]
pub(crate) use crate::browser::site_settings::zoom::{
    __cmd__browser_set_site_zoom_levels, __tauri_command_name_browser_set_site_zoom_levels,
    browser_set_site_zoom_levels,
};
