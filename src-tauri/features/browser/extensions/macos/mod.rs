// SPDX-License-Identifier: MIT
//! Misty's WebExtension host for macOS, on WebKit's `WKWebExtension` API (macOS 15.4+).
//! Each Space has its own host: its own `WKWebExtensionController` over the Space's website
//! data store. Everything here runs on the main thread.
mod accessors;
mod actions;
mod bridge;
mod compat;
mod compat_actions;
mod compat_events;
mod delegate;
mod downloads;
mod grants;
mod host;
mod layout;
mod lifecycle;
mod load;
mod native_connection;
mod native_messaging;
mod notification_post;
mod notifications;
mod open_tabs;
mod packages;
mod policy;
mod popup_delegate;
mod popup_windows;
mod prompts;
mod requests;
mod site_data;
mod state;
mod support;
mod sync_bridge;
mod tab_bridge;
mod tab_ops;
mod tabs;
#[doc(hidden)]
pub mod testing;
mod windows;

pub use bridge::{request, supported};
pub use compat::{compat_requires, set_compat_channel};
pub use downloads::download_header_allowed;
pub use policy::set_navigation_policy;
pub use support::Reply;
pub use tab_bridge::{compat_message, configuration, navigation, register_tab, tab_event};

/// Where host events go: the app's extension event channel.
pub fn set_events(emit: impl Fn(serde_json::Value) + Send + Sync + 'static) {
    accessors::set_emitter(std::sync::Arc::new(emit));
}
