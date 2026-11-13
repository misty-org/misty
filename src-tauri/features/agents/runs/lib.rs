//! Misty's agent, in the app's own process.
//!
//! - [`model_calls`] talks to model providers: what Misty uses from the Vercel AI SDK, and nothing
//!   more.
//! - Everything else in the crate runs agents on top of it. It depends on `model_calls`, never the
//!   other way round (`tests/boundaries.rs`).
//!
//! The crate knows nothing about Tauri. The app gives it what it needs through small interfaces.

pub mod model_calls;

pub mod device;
pub mod live;
pub mod voice;
pub(crate) mod agent_api;
pub(crate) mod agent_runtime;
pub(crate) mod clock;
pub(crate) mod control_plane;
pub(crate) mod control_plane_steps;
pub(crate) mod device_hooks;
pub(crate) mod device_models;
pub(crate) mod instance_model;
pub mod local_run;
pub(crate) mod local_prompt;
pub use local_prompt::{companion_engine_note, without_cursor_tags};
pub mod local_tools;
pub(crate) mod logger;
pub(crate) mod tool_gateway;
pub(crate) mod run;
pub(crate) mod teach_turn;
pub(crate) mod tool_calls;
pub(crate) mod text;
pub(crate) mod browser_reinspection;
pub(crate) mod citation_check;
pub(crate) mod closing_answer;
pub(crate) mod compaction_model;
pub(crate) mod context;
pub(crate) mod count_check;
pub(crate) mod document_ids;
pub(crate) mod finish_check;
pub(crate) mod finish_verification;
pub(crate) mod js_json;
pub(crate) mod js_regex;
pub(crate) mod ledger;
pub(crate) mod loop_guard;
pub(crate) mod model_access;
pub(crate) mod model_budget;
pub(crate) mod model_family;
pub(crate) mod person_takeover;
pub(crate) mod persistence_check;
pub(crate) mod requirements_review;
pub(crate) mod research_budget;
pub(crate) mod screen_session;
pub(crate) mod task_completion;
pub(crate) mod time_budget;
pub(crate) mod transcript;
pub(crate) mod transcript_json;
pub(crate) mod turn_deadline;
pub(crate) mod proof_tabs;
pub(crate) mod companion_images;
pub(crate) mod tool_errors;
pub(crate) mod model_input;
pub(crate) mod model_tools;
pub(crate) mod network;
pub(crate) mod opened_pages;
pub(crate) mod runtime_errors;
pub(crate) mod serial_tool_lifecycle;
pub(crate) mod tool_execution;
pub(crate) mod tool_monitor;
pub(crate) mod tool_outcomes;
pub(crate) mod tool_schema;
pub(crate) mod tool_transport;
pub(crate) mod toolsets;
pub(crate) mod web_fetch;
/// Whether an address is on the public internet, the one check agents' pages and web.fetch share.
pub use web_fetch::public_fetch::is_public_ip;
pub(crate) mod web_search;
/// A notebook's recent news, on this device's search provider and key.
pub use web_search::news::{device_news, NewsHit, NewsSearchError, MAX_NEWS};
#[cfg(test)]
pub(crate) mod tools_parity_tests;

pub use agent_api::{runtime_client_builder, AgentRuntimeOptions, ResumedRuns, RuntimeApiError, ToolHook};
pub use agent_runtime::AgentRuntime;
pub use logger::{LogSink, Logger};
pub use page_text::readable::ReadablePage;
pub use web_fetch::reader::{InProcessPageReader, PageReadError, PageReader};
