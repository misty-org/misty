mod call;
mod error;
mod generate;
mod http;
mod ids;
mod media;
mod media_type;
mod model;
mod prompt;
mod providers;
mod raw_json;
mod route;
mod sse;
mod stream;
mod tool_calls;

pub use call::{CallOptions, ResponseFormat, ToolChoice, ToolDefinition};
pub use error::{ModelError, RetryReason};
pub use generate::{
    collect_turn, generate_text, prepare_call, start_stream, to_model_prompt, with_retries,
    CollectedToolCall, CollectedTurn, GenerateResult, GenerateSettings, OutputObject,
    OutputValidator, DEFAULT_MAX_RETRIES,
};
pub use media::{
    embed_many, generate_speech, resolve_embedding_model, resolve_speech_model,
    resolve_transcription_model, transcribe, EmbedManyResult, EmbedResponse, EmbeddingModel,
    GeneratedSpeech, SpeechModel, SpeechRequest, SpeechResponse, TranscriptSegment,
    TranscriptionModel, TranscriptionResponse,
};
pub use model::{LanguageModel, ModelStream};
pub use prompt::{
    AssistantPart, FileData, Message, OutputItem, ProviderOptions, ToolOutput, ToolResultPart,
    UserPart,
};
pub use raw_json::RawJson;
pub use route::{parse_model_id, resolve_model, Credential, ModelRoute, ProviderId};
pub use stream::{FinishReason, InputTokens, OutputTokens, StreamPart, Usage};

#[doc(hidden)]
pub mod testing {
    use std::sync::Arc;

    use super::SpeechModel;

    pub fn elevenlabs_speech_model(
        client: &reqwest::Client,
        base_url: &str,
        key: &str,
        model: &str,
    ) -> Arc<dyn SpeechModel> {
        super::media::elevenlabs_speech_model(client.clone(), base_url, key, model)
    }
}
