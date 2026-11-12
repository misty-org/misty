//! A short video clip on the device's video model and key: Tutor films each scene of a video
//! overview with it. Google's Gemini Omni is the one video API a person's key reaches now (OpenAI's
//! Videos API and the Veo previews have shut down); it answers with the MP4 inline, in one call.
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use super::{CallError, DeviceCalls, DeviceRole};
use crate::model_calls::{parse_model_id, ModelError, ProviderId};

const GOOGLE: &str = "https://generativelanguage.googleapis.com/v1beta";
/// A clip takes a minute or two to make; a stuck one gives up rather than holding the scene.
const LIMIT: Duration = Duration::from_secs(600);

/// One clip's request: what it shows, how long it runs, and whether it is upright.
pub struct VideoCall<'a> {
    pub prompt: &'a str,
    pub seconds: u8,
}

fn refused(status: u16) -> CallError {
    // Provider bodies may echo a key, so only the status is kept.
    let message = match status {
        401 | 403 => "Google refused the video model's key. Check it in Settings → Models.".to_owned(),
        404 => "Google doesn't offer that video model. Choose another in Settings → Models.".to_owned(),
        429 => "The video model's limit is reached. Try again later.".to_owned(),
        _ => format!("The video model couldn't make this clip (status {status})."),
    };
    CallError::Call { status: 502, code: "model_call_failed", message }
}

/// The MP4 inside an interaction: the `video` item of its `model_output` step.
fn video_of(answer: &Value) -> Option<Vec<u8>> {
    let steps = answer.get("steps")?.as_array()?;
    let data = steps
        .iter()
        .filter(|step| step.get("type").and_then(Value::as_str) == Some("model_output"))
        .flat_map(|step| step.get("content").and_then(Value::as_array).into_iter().flatten())
        .find(|item| item.get("type").and_then(Value::as_str) == Some("video"))?
        .get("data")?
        .as_str()?;
    base64::engine::general_purpose::STANDARD.decode(data).ok()
}

impl DeviceCalls {
    /// Films one clip on the device's video model. Answers the MP4's bytes.
    pub async fn make_video(&self, call: VideoCall<'_>) -> Result<Vec<u8>, CallError> {
        let (model, route) = self.on_device(DeviceRole::Video)?;
        let (provider, name) = parse_model_id(&model)?;
        if provider != ProviderId::Google {
            return Err(ModelError::Setup {
                code: "unsupported_model",
                detail: "Videos are made on a Google video model, such as google/gemini-omni-1.2-flash.".to_owned(),
            }
            .into());
        }
        let prompt = call.prompt.trim();
        if prompt.is_empty() {
            return Err(CallError::invalid());
        }
        let body = json!({
            "model": name,
            "input": prompt,
            "store": false,
            "background": false,
            "stream": false,
            "response_format": {
                "type": "video",
                "duration": format!("{}s", call.seconds.clamp(3, 15)),
                "aspect_ratio": "16:9",
                "resolution": "720p",
            },
        });
        let response = self
            .client
            .post(format!("{GOOGLE}/interactions"))
            .header("x-goog-api-key", route.credential.api_key.trim())
            .timeout(LIMIT)
            .json(&body)
            .send()
            .await
            .map_err(|error| if error.is_timeout() { CallError::TimedOut } else { CallError::Unreadable("The video model couldn't be reached.") })?;
        let status = response.status().as_u16();
        if !response.status().is_success() {
            return Err(refused(status));
        }
        let answer: Value = response.json().await.map_err(|_| CallError::Unreadable("The video model's answer couldn't be read."))?;
        video_of(&answer).ok_or_else(|| CallError::Call {
            status: 502,
            code: "model_call_failed",
            message: "The video model answered without a video. It may have declined this scene.".to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_video_in_the_model_output_step() {
        let mp4 = base64::engine::general_purpose::STANDARD.encode(b"mp4 bytes");
        let answer = json!({
            "steps": [
                { "type": "user_input", "content": [{ "type": "text", "text": "a leaf" }] },
                { "type": "thought", "content": [{ "type": "thought", "text": "..." }] },
                { "type": "model_output", "content": [{ "type": "video", "mime_type": "video/mp4", "data": mp4 }] },
            ],
            "status": "completed",
        });
        assert_eq!(video_of(&answer).as_deref(), Some(&b"mp4 bytes"[..]));
        assert!(video_of(&json!({ "steps": [{ "type": "model_output", "content": [] }] })).is_none());
    }

    #[test]
    fn a_refusal_keeps_only_the_status() {
        let CallError::Call { message, .. } = refused(403) else { panic!() };
        assert!(message.contains("key"));
        let CallError::Call { message, .. } = refused(500) else { panic!() };
        assert!(message.contains("500"));
    }
}
