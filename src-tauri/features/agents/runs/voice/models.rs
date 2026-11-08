//! The voice on this device's transcription, fast and speech models (`voice/models.ts`).
use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde_json::Value;

use super::super::{
    device::{
        model_calls::{asking, routed_generate, user_text},
        speech_call, CallError, DeviceModels, DeviceRole, SpeechCall,
    },
    text::{js_prefix, js_suffix},
};
use super::session::{VoiceDecision, VoiceModels};
use crate::model_calls::{resolve_speech_model, resolve_transcription_model, transcribe, Message, ModelError, ModelRoute, OutputObject, RawJson};

/// 24 kHz 16-bit mono PCM as a WAV file, which every transcription model takes.
pub(crate) fn wav(pcm: &[u8]) -> Vec<u8> {
    const RATE: u32 = 24_000;
    let length = pcm.len() as u32;
    let mut file = Vec::with_capacity(44 + pcm.len());
    file.extend_from_slice(b"RIFF");
    file.extend_from_slice(&(36 + length).to_le_bytes());
    file.extend_from_slice(b"WAVEfmt ");
    file.extend_from_slice(&16u32.to_le_bytes());
    file.extend_from_slice(&1u16.to_le_bytes());
    file.extend_from_slice(&1u16.to_le_bytes());
    file.extend_from_slice(&RATE.to_le_bytes());
    file.extend_from_slice(&(RATE * 2).to_le_bytes());
    file.extend_from_slice(&2u16.to_le_bytes());
    file.extend_from_slice(&16u16.to_le_bytes());
    file.extend_from_slice(b"data");
    file.extend_from_slice(&length.to_le_bytes());
    file.extend_from_slice(pcm);
    file
}

/// `deviceVoiceModels`.
pub struct DeviceVoiceModels {
    models: Arc<dyn DeviceModels>,
    client: reqwest::Client,
}

impl DeviceVoiceModels {
    pub fn new(models: Arc<dyn DeviceModels>, client: reqwest::Client) -> Self {
        Self { models, client }
    }

    fn on_device(&self, role: DeviceRole, what: &str) -> Result<(String, ModelRoute), ModelError> {
        let model = self.models.model_id(role).ok_or_else(|| ModelError::Setup {
            code: "model_key_needed",
            detail: format!("Choose a {what} model in Settings → Models."),
        })?;
        let route = self.models.route(&model)?;
        Ok((model, route))
    }
}

/// The schema is given as plain JSON, so an answer that reads as JSON isn't checked against it.
fn voice_turn_output(tools: &[String]) -> Result<OutputObject, CallError> {
    let mut choices = vec![String::new()];
    choices.extend_from_slice(tools);
    let choices = serde_json::to_string(&choices).map_err(|_| CallError::Unreadable("Invalid schema"))?;
    let schema = format!(
        r#"{{"type":"object","additionalProperties":false,"required":["say","tool","instruction"],"properties":{{"say":{{"type":"string"}},"tool":{{"type":"string","enum":{choices}}},"instruction":{{"type":"string"}}}}}}"#
    );
    let schema = RawJson::from_text(schema).map_err(|_| CallError::Unreadable("Invalid schema"))?;
    Ok(OutputObject::new(schema).named("voice_turn"))
}

/// A field the session reads as text. The model could have written anything.
fn text_field(reply: &Value, key: &str) -> Option<String> {
    reply.get(key)?.as_str().map(str::to_owned)
}

impl DeviceVoiceModels {
    /// `reply`, separated so tests reach it without a session.
    pub(crate) async fn decide(&self, system: &str, messages: Vec<Message>, tools: &[String]) -> Result<VoiceDecision, CallError> {
        let (model, route) = self.on_device(DeviceRole::Fast, "fast")?;
        let asked = if messages.is_empty() { vec![user_text("(The user has not spoken yet.)")] } else { messages.clone() };
        let options = asking(Some(system), asked, 300);
        let answered = routed_generate(&self.client, &model, &route, options, Some(voice_turn_output(tools)?)).await;
        let result = match answered {
            // A model that can't give JSON still answers in words.
            Err(error) if !matches!(error, ModelError::Setup { .. }) => {
                let plain = asking(Some(system), messages, 300);
                let spoken = routed_generate(&self.client, &model, &route, plain, None).await?;
                return Ok(VoiceDecision {
                    say: Some(spoken.turn.text),
                    tool: Some(String::new()),
                    instruction: Some(String::new()),
                });
            }
            other => other?,
        };
        let reply = result.output()?;
        Ok(VoiceDecision {
            say: text_field(reply, "say"),
            tool: text_field(reply, "tool"),
            instruction: text_field(reply, "instruction"),
        })
    }
}

impl VoiceModels for DeviceVoiceModels {
    fn transcribe<'a>(&'a self, pcm: &'a [u8]) -> BoxFuture<'a, Result<String, CallError>> {
        Box::pin(async move {
            if pcm.is_empty() {
                return Ok(String::new());
            }
            let (model, route) = self.on_device(DeviceRole::Transcription, "transcription")?;
            let resolved = resolve_transcription_model(&model, &route, &self.client)?;
            Ok(transcribe(resolved.as_ref(), &wav(pcm), None, Some(1)).await?.text)
        })
    }

    fn reply<'a>(&'a self, system: &'a str, messages: Vec<Message>, tools: &'a [String]) -> BoxFuture<'a, Result<VoiceDecision, CallError>> {
        Box::pin(self.decide(system, messages, tools))
    }

    fn speak<'a>(&'a self, text: &'a str, previous: &'a str, next: &'a str) -> BoxFuture<'a, Result<Vec<u8>, CallError>> {
        Box::pin(async move {
            let (model, route) = self.on_device(DeviceRole::Speech, "speech")?;
            let resolved = resolve_speech_model(&model, &route, &self.client)?;
            // A voice ID only means anything to ElevenLabs, whichever provider is chosen.
            let voice = self.models.speech_voice().filter(|_| model.starts_with("elevenlabs/"));
            let call = SpeechCall {
                model: &model,
                text,
                voice: voice.as_deref(),
                previous_text: (!previous.is_empty()).then(|| js_suffix(previous, 4000)),
                next_text: (!next.is_empty()).then(|| js_prefix(next, 4000)),
            };
            speech_call(resolved.as_ref(), call).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wav_file_starts_with_its_header() {
        let file = wav(&[0; 10]);
        assert_eq!(&file[..4], b"RIFF");
        assert_eq!(file.len(), 54);
    }

    #[test]
    fn the_schema_keeps_its_order_and_offers_only_the_turns_tools() {
        let output = voice_turn_output(&["get_context".to_owned()]).ok().unwrap();
        assert_eq!(
            output.schema.get(),
            r#"{"type":"object","additionalProperties":false,"required":["say","tool","instruction"],"properties":{"say":{"type":"string"},"tool":{"type":"string","enum":["","get_context"]},"instruction":{"type":"string"}}}"#
        );
        assert_eq!(output.name.as_deref(), Some("voice_turn"));
    }
}
