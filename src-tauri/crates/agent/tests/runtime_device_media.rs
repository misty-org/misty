//! The device calls that carry sound: transcription, speaker turns and speech, against a local
//! provider.
#[path = "runtime_device_support/mod.rs"]
mod support;

use misty_agent::{
    runtime::device::{model_call_failure, speech_call, DeviceCallFailure, SpeechCall},
    sdk::{resolve_speech_model, testing, Credential, ModelRoute, ProviderId},
};
use serde_json::{json, Value};
use support::{calls, client, provider, Answer, Device};

fn route(provider: ProviderId, key: &str, base_url: Option<&str>) -> ModelRoute {
    ModelRoute { reasoning: Some("low".to_owned()), credential: Credential { provider, api_key: key.to_owned(), base_url: base_url.map(str::to_owned) } }
}

async fn transcribing(reply: Value) -> (Result<Value, DeviceCallFailure>, support::Provider) {
    let server = provider(move |_| Answer::json(200, reply.clone())).await;
    let device = Device::default().with_model("transcription", "openai/whisper-1").with_key(ProviderId::Openai, "k", &server.base_url);
    let body = json!({ "audio_base64": "AAAA", "mime_type": "audio/webm;codecs=opus", "duration_ms": 1234 }).to_string();
    (calls(device).voice_transcription(&body).await, server)
}

#[tokio::test]
async fn a_spoken_request_is_transcribed_with_its_language_and_length() {
    let (result, server) = transcribing(json!({ "text": "ignored", "language": "english", "duration": 1.5, "segments": [
        { "text": " Hello ", "start": 0, "end": 1 }, { "text": " ", "start": 1, "end": 1 }, { "text": "there", "start": 1, "end": 2 },
    ] })).await;
    assert_eq!(result.unwrap(), json!({ "transcript": "Hello there", "detected_language": "en", "duration_ms": 1500 }));
    assert_eq!(server.requests()[0].path, "/v1/audio/transcriptions");
}

#[tokio::test]
async fn a_spoken_request_without_a_length_keeps_the_one_it_came_with() {
    let (result, _) = transcribing(json!({ "text": " Hi " })).await;
    assert_eq!(result.unwrap(), json!({ "transcript": "Hi", "detected_language": "", "duration_ms": 1234 }));
}

#[tokio::test]
async fn silence_is_its_own_failure() {
    let (result, _) = transcribing(json!({ "text": "  " })).await;
    assert_eq!(result.unwrap_err(), DeviceCallFailure { status: 422, body: json!({ "code": "no_speech", "message": "No speech was detected." }) });
}

#[tokio::test]
async fn voice_recordings_are_checked_before_any_call() {
    let server = provider(|_| Answer::json(200, json!({ "text": "x" }))).await;
    let device = || Device::default().with_model("transcription", "openai/whisper-1").with_key(ProviderId::Openai, "k", &server.base_url);
    for body in [
        json!({ "audio_base64": "", "mime_type": "audio/webm", "duration_ms": 1 }),
        json!({ "audio_base64": "A!!A", "mime_type": "audio/webm", "duration_ms": 1 }),
        json!({ "audio_base64": "AAAA", "mime_type": "video/webm", "duration_ms": 1 }),
        json!({ "audio_base64": "AAAA", "mime_type": "audio/webm", "duration_ms": 60_001 }),
        json!({ "audio_base64": "AAAA", "mime_type": "audio/webm", "duration_ms": 1.5 }),
    ] {
        assert_eq!(calls(device()).voice_transcription(&body.to_string()).await.unwrap_err().status, 400, "{body}");
    }
    assert!(server.requests().is_empty());
}

#[tokio::test]
async fn who_said_what_runs_on_sonioxs_async_model() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/runtime_device/soniox-async-two-speakers.json")).unwrap();
    let tokens = fixture["tokens"].clone();
    let server = provider(move |request| match (request.method.as_str(), request.path.as_str()) {
        ("POST", "/v1/files") => Answer::json(200, json!({ "id": "file-1" })),
        ("POST", "/v1/transcriptions") => Answer::json(200, json!({ "id": "job-1" })),
        ("GET", "/v1/transcriptions/job-1") => Answer::json(200, json!({ "status": "completed", "audio_duration_ms": 2500 })),
        ("GET", "/v1/transcriptions/job-1/transcript") => Answer::json(200, json!({ "text": "Morning everyone.", "tokens": tokens })),
        _ => Answer::json(200, json!({})),
    })
    .await;
    let origin = server.base_url.trim_end_matches("/v1").to_owned();
    let device = Device::default().with_key(ProviderId::Soniox, "soniox-key-fixture", &origin);
    let body = json!({ "mediaType": "audio/wav", "audio": "UklGRg==", "languages": ["en"], "context": { "terms": ["Dana"], "extra": 1 } });
    let result = calls(device).transcribe_diarized(&body.to_string()).await.unwrap();
    assert_eq!(result["text"], "Morning everyone.");
    assert_eq!(result["durationInSeconds"], 2.5);
    assert_eq!(result["turns"][1], json!({ "speaker": "2", "language": "en", "start": 1.1, "end": 1.7, "text": "Hi Dana." }));
    let job = server.requests().into_iter().find(|request| request.path == "/v1/transcriptions" && request.method == "POST").unwrap().json();
    assert_eq!(job["model"], "stt-async-v4");
    assert_eq!(job["enable_speaker_diarization"], true);
    assert_eq!(job["enable_language_identification"], true);
    assert_eq!(job["language_hints"], json!(["en"]));
    assert_eq!(job["context"], json!({ "terms": ["Dana"] }));
}

#[tokio::test]
async fn who_said_what_needs_a_soniox_key_and_a_media_type() {
    needs_key(calls(Device::default()).transcribe_diarized(r#"{"mediaType":"audio/wav","audio":"AA"}"#).await.unwrap_err());
    let device = Device::default().with_key(ProviderId::Soniox, "k", "http://127.0.0.1:9");
    assert_eq!(calls(device).transcribe_diarized(r#"{"mediaType":"text/plain","audio":"AA"}"#).await.unwrap_err().status, 400);
}

fn needs_key(failure: DeviceCallFailure) {
    assert_eq!(failure, DeviceCallFailure { status: 409, body: json!({ "code": "model_key_needed", "message": "Add a model key in Settings → Models." }) });
}

#[tokio::test]
async fn elevenlabs_speech_asks_for_pcm_and_carries_the_sentences_around_it() {
    let server = provider(|_| Answer { status: 200, content_type: "audio/pcm".to_owned(), body: vec![1, 2, 3, 4] }).await;
    let origin = server.base_url.trim_end_matches("/v1");
    let model = testing::elevenlabs_speech_model(&client(), origin, "eleven-key", "eleven_v3");
    let audio = speech_call(model.as_ref(), SpeechCall { model: "elevenlabs/eleven_v3", text: "Hello.", voice: None, previous_text: Some("Before."), next_text: Some("After.") }).await.unwrap();
    assert_eq!(audio, [1, 2, 3, 4]);
    let request = &server.requests()[0];
    assert!(request.path.ends_with("?output_format=pcm_24000"), "{}", request.path);
    let body = request.json();
    assert_eq!(body["previous_text"], "Before.");
    assert_eq!(body["next_text"], "After.");
}

#[tokio::test]
async fn openai_speech_asks_for_pcm_in_the_default_voice() {
    let server = provider(|_| Answer { status: 200, content_type: "audio/pcm".to_owned(), body: vec![5, 6] }).await;
    let device = route(ProviderId::Openai, "k", Some(&server.base_url));
    let model = resolve_speech_model("openai/tts-1", &device, &client()).unwrap();
    let audio = speech_call(model.as_ref(), SpeechCall { model: "openai/tts-1", text: "Hi", voice: None, previous_text: Some("ignored"), next_text: None }).await.unwrap();
    assert_eq!(audio, [5, 6]);
    let body = server.requests()[0].json();
    assert_eq!(body["voice"], "alloy");
    assert_eq!(body["response_format"], "pcm");
    assert!(body.get("previous_text").is_none());
}

#[tokio::test]
async fn speech_checks_its_input() {
    let server = provider(|_| Answer { status: 200, content_type: "audio/pcm".to_owned(), body: vec![1] }).await;
    let device = route(ProviderId::Openai, "k", Some(&server.base_url));
    let model = resolve_speech_model("openai/tts-1", &device, &client()).unwrap();
    let call = |text: &'static str, voice: Option<&'static str>| SpeechCall { model: "openai/tts-1", text, voice, previous_text: None, next_text: None };
    for bad in [call("", None), call("Hi", Some("no spaces"))] {
        assert_eq!(model_call_failure(&speech_call(model.as_ref(), bad).await.unwrap_err()).status, 400);
    }
    assert!(server.requests().is_empty());
}
