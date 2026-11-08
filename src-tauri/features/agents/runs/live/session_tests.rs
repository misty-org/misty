//! `test/live-relay.test.ts`. The ticket tests went with the tickets, and the key tests are in
//! `credential_tests.rs`.
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::future::{BoxFuture, FutureExt};
use serde_json::{json, Value};
use tokio::sync::mpsc::{self, UnboundedReceiver};

use super::{
    super::js_json::JsValue,
    segment::LiveChannel,
    session::{LiveSession, LiveSessionSpec, SttError, SttEvent, SttEvents, SttFactory, SttStream},
    soniox::{parse_message, SonioxConfig, SonioxResult},
};

fn fixture_results() -> Vec<Value> {
    let fixture: Value = serde_json::from_str(include_str!("../tests/fixtures/runtime_device/soniox-live-two-speakers.json")).unwrap();
    fixture["results"].as_array().unwrap().clone()
}

/// Replays recorded Soniox results as audio arrives, like the provider.
struct ReplayStream {
    heard: Vec<SonioxResult>,
    next: Mutex<usize>,
    events: SttEvents,
    audio: Mutex<usize>,
}

impl ReplayStream {
    fn play(&self) -> bool {
        let at = {
            let mut next = self.next.lock().unwrap();
            let at = *next;
            *next += 1;
            at
        };
        let Some(result) = self.heard.get(at) else {
            return false;
        };
        (self.events)(SttEvent::Result(result.clone()));
        if result.tokens.iter().any(|token| token.text == "<end>") {
            (self.events)(SttEvent::Endpoint);
        }
        true
    }
}

impl SttStream for ReplayStream {
    fn connect(&self) -> BoxFuture<'_, Result<(), SttError>> {
        async { Ok(()) }.boxed()
    }

    fn send_audio(&self, data: &[u8]) -> Result<(), SttError> {
        *self.audio.lock().unwrap() += data.len();
        self.play();
        Ok(())
    }

    fn finish(&self) -> BoxFuture<'_, Result<(), SttError>> {
        async move { while self.play() {} Ok(()) }.boxed()
    }

    fn close(&self) {}
}

#[derive(Default)]
struct Replay {
    results: Vec<Value>,
    /// Streams open in channel order; only this one hears the recording.
    channel: usize,
    configs: Mutex<Vec<SonioxConfig>>,
}

impl SttFactory for Replay {
    fn open(&self, config: &SonioxConfig, events: SttEvents) -> Arc<dyn SttStream> {
        let mut configs = self.configs.lock().unwrap();
        configs.push(config.clone());
        let heard = if configs.len() - 1 == self.channel { self.results.iter().map(|result| parse_message(&result.to_string()).unwrap().result).collect() } else { Vec::new() };
        Arc::new(ReplayStream { heard, next: Mutex::new(0), events, audio: Mutex::new(0) })
    }
}

pub(super) fn spec(max_ms: u64) -> LiveSessionSpec {
    LiveSessionSpec { sid: "s1".to_owned(), channels: vec![LiveChannel::Mic, LiveChannel::System], max_ms, language: None, model: "soniox/stt-rt-v4".to_owned() }
}

fn frame(channel: u8, ms: usize) -> Vec<u8> {
    let mut frame = vec![channel];
    frame.resize(1 + ms * 32, 0);
    frame
}

fn drained(receiver: &mut UnboundedReceiver<Value>) -> Vec<Value> {
    let mut sent = Vec::new();
    while let Ok(message) = receiver.try_recv() {
        sent.push(message);
    }
    sent
}

fn finals(sent: &[Value]) -> Vec<&Value> {
    sent.iter().filter(|message| message["type"] == "segment" && message["segment"]["final"] == true).map(|message| &message["segment"]).collect()
}

fn start_message(value: Value) -> JsValue {
    JsValue::parse(&value.to_string()).unwrap()
}

#[tokio::test]
async fn relays_diarized_segments_per_channel() {
    let replay = Arc::new(Replay { results: fixture_results(), channel: 1, ..Replay::default() });
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = LiveSession::new(spec(60_000), sender, replay.clone());
    session.start(&start_message(json!({ "type": "start", "language": "en", "context": { "terms": ["Misty"], "text": "Design review" } }))).await;
    {
        let configs = replay.configs.lock().unwrap();
        assert_eq!(configs.len(), 2);
        let config = serde_json::to_value(&configs[0]).unwrap();
        assert_eq!(config["model"], "stt-rt-v4");
        assert_eq!(config["enable_speaker_diarization"], true);
        assert_eq!(config["enable_endpoint_detection"], true);
        assert_eq!(config["sample_rate"], 16000);
        assert_eq!(config["context"], json!({ "terms": ["Misty"], "text": "Design review" }));
        assert!(config.get("translation").is_none());
    }
    let mut sent = drained(&mut receiver);
    assert_eq!(sent[0], json!({ "type": "ready", "channels": ["mic", "system"], "maxMs": 60_000 }));
    for _ in 0..5 {
        session.audio(&frame(1, 100));
    }
    session.finish().await;
    session.close();
    sent.extend(drained(&mut receiver));
    let finals = finals(&sent);
    let summary: Vec<(String, String, String)> = finals
        .iter()
        .map(|segment| (segment["channel"].as_str().unwrap().to_owned(), segment["speaker"].as_str().unwrap().to_owned(), segment["sourceText"].as_str().unwrap().to_owned()))
        .collect();
    assert_eq!(
        summary,
        [
            ("system".to_owned(), "1".to_owned(), "Can we ship Thursday?".to_owned()),
            ("system".to_owned(), "2".to_owned(), "Yes, after review.".to_owned()),
        ]
    );
    let words: Vec<&str> = finals[0]["words"].as_array().unwrap().iter().map(|word| word["text"].as_str().unwrap()).collect();
    assert_eq!(words, ["Can", "we", "ship", "Thursday?"]);
    assert_eq!(sent.last().unwrap(), &json!({ "type": "finished", "usedMs": 500 }));
}

#[tokio::test]
async fn translates_only_when_the_start_asks_for_another_language() {
    let results = vec![json!({ "tokens": [
        { "text": "Hola", "is_final": true, "translation_status": "original" },
        { "text": "Hello", "is_final": true, "translation_status": "translation" },
    ] })];
    let replay = Arc::new(Replay { results, channel: 0, ..Replay::default() });
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = LiveSession::new(LiveSessionSpec { channels: vec![LiveChannel::System], ..spec(60_000) }, sender, replay.clone());
    session.start(&start_message(json!({ "type": "start", "language": "auto", "target": "en" }))).await;
    assert_eq!(serde_json::to_value(&replay.configs.lock().unwrap()[0]).unwrap()["translation"], json!({ "type": "one_way", "target_language": "en" }));
    session.audio(&frame(1, 100));
    session.finish().await;
    let sent = drained(&mut receiver);
    let finals = finals(&sent);
    assert_eq!(finals.len(), 1);
    assert_eq!(finals[0]["sourceText"], "Hola");
    assert_eq!(finals[0]["translatedText"], "Hello");
}

#[tokio::test]
async fn stops_at_the_limit_and_counts_only_what_was_sent() {
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = LiveSession::new(spec(250), sender, Arc::new(Replay::default()));
    session.start(&start_message(json!({ "type": "start" }))).await;
    session.audio(&frame(0, 200));
    session.audio(&frame(0, 200));
    session.audio(&frame(0, 200));
    let mut sent = Vec::new();
    while !sent.iter().any(|message: &Value| message["type"] == "finished") {
        sent.push(tokio::time::timeout(Duration::from_secs(5), receiver.recv()).await.unwrap().unwrap());
    }
    assert_eq!(sent.last().unwrap(), &json!({ "type": "finished", "usedMs": 250 }));
    assert!(sent.iter().any(|message| message["type"] == "limit"));
    assert_eq!(session.used_ms(), 250);
}

#[tokio::test]
async fn ignores_audio_for_channels_the_session_wasnt_given() {
    let (sender, _receiver) = mpsc::unbounded_channel();
    let session = LiveSession::new(LiveSessionSpec { channels: vec![LiveChannel::Mic], ..spec(60_000) }, sender, Arc::new(Replay::default()));
    session.start(&start_message(json!({ "type": "start" }))).await;
    session.audio(&frame(1, 100));
    session.audio(&frame(7, 100));
    session.close();
    assert_eq!(session.used_ms(), 0);
}

struct FailingStream;

impl SttStream for FailingStream {
    fn connect(&self) -> BoxFuture<'_, Result<(), SttError>> {
        // A real failure might read "401 api key sk-secret rejected", and none of it goes further.
        async { Err(SttError) }.boxed()
    }

    fn send_audio(&self, _data: &[u8]) -> Result<(), SttError> {
        Err(SttError)
    }

    fn finish(&self) -> BoxFuture<'_, Result<(), SttError>> {
        async { Ok(()) }.boxed()
    }

    fn close(&self) {}
}

struct Failing;

impl SttFactory for Failing {
    fn open(&self, _config: &SonioxConfig, _events: SttEvents) -> Arc<dyn SttStream> {
        Arc::new(FailingStream)
    }
}

#[tokio::test]
async fn reports_a_provider_failure_without_its_details() {
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = LiveSession::new(spec(60_000), sender, Arc::new(Failing));
    session.start(&start_message(json!({ "type": "start" }))).await;
    let sent = drained(&mut receiver);
    assert_eq!(sent, [json!({ "type": "error", "message": "Live transcription couldn't start. Try again in a moment." })]);
    // Nothing more comes of it, and a finish after a failure says nothing.
    session.finish().await;
    assert!(drained(&mut receiver).is_empty());
}

#[tokio::test]
async fn a_malformed_context_leaves_the_session_with_no_streams() {
    let replay = Arc::new(Replay::default());
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let session = LiveSession::new(spec(60_000), sender, replay.clone());
    session.start(&start_message(json!({ "type": "start", "context": { "terms": "Misty" } }))).await;
    assert!(replay.configs.lock().unwrap().is_empty());
    assert!(drained(&mut receiver).is_empty());
    session.finish().await;
    assert_eq!(drained(&mut receiver), [json!({ "type": "finished", "usedMs": 0 })]);
}

#[tokio::test]
async fn context_stays_within_its_bounds() {
    let replay = Arc::new(Replay::default());
    let (sender, _receiver) = mpsc::unbounded_channel();
    let session = LiveSession::new(LiveSessionSpec { channels: vec![LiveChannel::Mic], ..spec(60_000) }, sender, replay.clone());
    let terms: Vec<String> = (0..205).map(|index| format!("  term{index}{}  ", "x".repeat(200))).collect();
    let general: Vec<Value> = (0..12).map(|index| json!({ "key": format!("k{index}"), "value": "v" })).collect();
    session.start(&start_message(json!({ "type": "start", "language": "cmn", "context": {
        "terms": terms, "general": general, "text": "t".repeat(5000),
        "translation_terms": [{ "source": " a ", "target": " b " }, { "source": " ", "target": "b" }, 3],
    } }))).await;
    let config = serde_json::to_value(&replay.configs.lock().unwrap()[0]).unwrap();
    assert_eq!(config["language_hints"], json!(["zh"]));
    assert_eq!(config["context"]["terms"].as_array().unwrap().len(), 200);
    assert_eq!(config["context"]["terms"][0].as_str().unwrap().len(), 160);
    assert_eq!(config["context"]["general"].as_array().unwrap().len(), 10);
    assert_eq!(config["context"]["text"].as_str().unwrap().len(), 4000);
    assert_eq!(config["context"]["translation_terms"], json!([{ "source": "a", "target": "b" }]));
}
