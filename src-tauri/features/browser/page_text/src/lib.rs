//! Readable text from a fetched page, and nothing else: no network, no files, no async. Two things
//! use it. `misty-agent` holds the rules that run on the result, and the confined worker
//! (`src-tauri/features/browser/page_text/worker`) runs [`protocol::answer`] on untrusted pages, so both read a
//! page the same way by being the same code.
mod html_tokens;
mod html_tree;
pub mod js_regex;
pub mod protocol;
pub mod readable;
pub mod text;
