//! Apps connected directly: the person signs in to an app's own MCP server, run by its maker, and
//! the tokens stay in this computer's keychain. No key of Misty's, no Misty server and no third
//! company in between. An app that doesn't offer this is used through its web page.
pub mod catalog;
pub mod client;
pub mod commands;
pub mod oauth;
pub mod store;
pub mod tools;

#[cfg(test)]
mod generate;
#[cfg(test)]
mod tests;
