//! Model calls. A call takes a [`CallOptions`] and gives back a stream of [`StreamPart`]s, the same
//! whichever provider serves it. The shapes match the Vercel AI SDK's language model interface, and
//! `tests/sdk_parity.rs` replays what that SDK sends and parses against these clients.

mod call;
mod error;
mod http;
mod model;
mod prompt;
mod providers;
mod raw_json;
mod route;
mod sse;
mod stream;
mod tool_calls;

pub use call::{CallOptions, ResponseFormat, ToolChoice, ToolDefinition};
pub use error::ModelError;
pub use model::{LanguageModel, ModelStream};
pub use prompt::{
    AssistantPart, FileData, Message, OutputItem, ProviderOptions, ToolOutput, ToolResultPart,
    UserPart,
};
pub use raw_json::RawJson;
pub use route::{parse_model_id, resolve_model, Credential, ModelRoute, ProviderId};
pub use stream::{FinishReason, InputTokens, OutputTokens, StreamPart, Usage};
