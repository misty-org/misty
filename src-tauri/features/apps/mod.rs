//! Space apps, the host's side. An app is a folder of static files and a `misty-app.json`
//! (`manifest`), kept per version in Misty's data folder (`bundle`), served to a sandboxed frame by the
//! `misty-app:` scheme (`scheme`), and allowed to call only what its manifest asked for and a Space mod
//! approved (`permissions`). An app whose MCP server is a program of its maker's has it run here, confined
//! to a chat's folder (`program`). A pasted GitHub link is turned into an app's pinned build (`resolve`).
//! The page's side of the SDK channel is `src/features/spaces/apps/`; native code decides here what each
//! call may do, never the page.

pub mod bundle;
pub mod commands;
pub mod manifest;
pub mod mcp;
pub mod permissions;
pub mod program;
pub mod resolve;
pub mod scheme;

