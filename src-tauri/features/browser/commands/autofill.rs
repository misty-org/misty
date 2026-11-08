//! Browser commands for autofill, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

#[cfg(desktop)]
pub(crate) use crate::browser::kiri_link::host_messages::autofill::{
    __cmd__browser_autofill_address_save, __cmd__browser_autofill_addresses_list,
    __cmd__browser_autofill_card_save, __cmd__browser_autofill_cards_list,
    __cmd__browser_autofill_choose, __cmd__browser_autofill_delete,
    __cmd__browser_autofill_offer_respond, __cmd__browser_autofill_open,
    __tauri_command_name_browser_autofill_address_save,
    __tauri_command_name_browser_autofill_addresses_list,
    __tauri_command_name_browser_autofill_card_save,
    __tauri_command_name_browser_autofill_cards_list, __tauri_command_name_browser_autofill_choose,
    __tauri_command_name_browser_autofill_delete,
    __tauri_command_name_browser_autofill_offer_respond,
    __tauri_command_name_browser_autofill_open, browser_autofill_address_save,
    browser_autofill_addresses_list, browser_autofill_card_save, browser_autofill_cards_list,
    browser_autofill_choose, browser_autofill_delete, browser_autofill_offer_respond,
    browser_autofill_open,
};
#[cfg(desktop)]
pub(crate) use crate::browser::kiri_link::host_messages::passwords::{
    __cmd__browser_page_password_fill, __cmd__browser_password_offer_respond,
    __cmd__browser_passwords_delete, __cmd__browser_passwords_list,
    __cmd__browser_passwords_reveal, __cmd__browser_passwords_save,
    __tauri_command_name_browser_page_password_fill,
    __tauri_command_name_browser_password_offer_respond,
    __tauri_command_name_browser_passwords_delete, __tauri_command_name_browser_passwords_list,
    __tauri_command_name_browser_passwords_reveal, __tauri_command_name_browser_passwords_save,
    browser_page_password_fill, browser_password_offer_respond, browser_passwords_delete,
    browser_passwords_list, browser_passwords_reveal, browser_passwords_save,
};
