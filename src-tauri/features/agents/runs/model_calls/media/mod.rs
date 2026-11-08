//! Models that don't chat: embedding, speech and transcription, on the same keys and rules as
//! language models. Only the paths `resolveEmbeddingModel`, `resolveSpeechModel` and
//! `resolveTranscriptionModel` route to in the TypeScript runtime are here.
mod embedding;
mod google_embedding;
mod http;
mod multipart;
mod openai_embedding;
mod soniox;
mod soniox_job;
mod speech;
mod transcription;

pub use embedding::{embed_many, resolve_embedding_model, EmbedManyResult, EmbedResponse, EmbeddingModel};
pub use speech::{generate_speech, resolve_speech_model, GeneratedSpeech, SpeechModel, SpeechRequest, SpeechResponse};
pub use transcription::{
    resolve_transcription_model, transcribe, TranscriptSegment, TranscriptionModel, TranscriptionResponse,
};

pub(crate) use speech::elevenlabs_speech_model;
