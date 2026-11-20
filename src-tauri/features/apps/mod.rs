//! Space apps, the host's side. An app is a folder of static files and a `misty-app.json`
//! (`manifest`), kept per version in Misty's data folder (`bundle`), served to a sandboxed frame by the
//! `misty-app:` scheme (`scheme`), and allowed to call only what its manifest asked for and a Space mod
//! approved (`permissions`). The page's side of the SDK channel is `src/apps/`; native code decides here
//! what each call may do, never the page.

pub mod bundle;
pub mod commands;
pub mod manifest;
pub mod mcp;
pub mod permissions;
pub mod scheme;

pub use commands::use_shipped;
