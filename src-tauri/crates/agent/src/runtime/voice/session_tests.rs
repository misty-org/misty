//! `test/voice-session.test.ts`.
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::future::{BoxFuture, FutureExt};
use serde_json::{json, Value};
use tokio::sync::{
    mpsc::{self, UnboundedReceiver},
    Notify,
};

use super::{
    super::{device::CallError, js_json::JsValue},
    models::wav,
    prompt::{split_sentences, voice_instructions, VOICE_TASK_RESULT_PROMPT},
    session::{VoiceDecision, VoiceModels, VoiceSession},
};
use crate::sdk::Message;

#[derive(Default)]
pub(super) struct FakeModels {
    pub(super) heard: String,
    pub(super) replies: Mutex<VecDeque<(&'static str, &'static str, &'static str)>>,
    tools: Mutex<Vec<Vec<String>>>,
    messages: Mutex<Vec<Vec<Message>>>,
    spoken: Mutex<Vec<(String, String, String)>>,
    /// When set, a reply waits here, and a dropped wait counts as a cancelled call.
    pub(super) hold: Option<Arc<Notify>>,
    pub(super) cancelled: Arc<Mutex<u32>>,
}

struct CountsDrops(Arc<Mutex<u32>>, bool);

impl Drop for CountsDrops {
    fn drop(&mut self) {
        if !self.1 {
            *self.0.lock().unwrap() += 1;
        }
    }
}

impl VoiceModels for FakeModels {
    fn transcribe<'a>(&'a self, _pcm: &'a [u8]) -> BoxFuture<'a, Result<String, CallError>> {
        async move { Ok(self.heard.clone()) }.boxed()
    }

    fn reply<'a>(&'a self, _system: &'a str, messages: Vec<Message>, tools: &'a [String]) -> BoxFuture<'a, Result<VoiceDecision, CallError>> {
        async move {
            self.tools.lock().unwrap().push(tools.to_vec());
            self.messages.lock().unwrap().push(messages);
            if let Some(hold) = &self.hold {
                let mut guard = CountsDrops(self.cancelled.clone(), false);
                hold.notified().await;
                guard.1 = true;
            }
            let (say, tool, instruction) = self.replies.lock().unwrap().pop_front().unwrap_or(("", "", ""));
            Ok(VoiceDecision { say: Some(say.to_owned()), tool: Some(tool.to_owned()), instruction: Some(instruction.to_owned()) })
        }
        .boxed()
    }

    fn speak<'a>(&'a self, text: &'a str, previous: &'a str, next: &'a str) -> BoxFuture<'a, Result<Vec<u8>, CallError>> {
        async move {
            self.spoken.lock().unwrap().push((text.to_owned(), previous.to_owned(), next.to_owned()));
            Ok(format!("pcm:{text}").into_bytes())
        }
        .boxed()
    }
}

pub(super) fn models(replies: &[(&'static str, &'static str, &'static str)]) -> FakeModels {
    FakeModels { heard: "what time is it".to_owned(), replies: Mutex::new(replies.iter().copied().collect()), ..FakeModels::default() }
}

fn event(value: Value) -> JsValue {
    JsValue::parse(&value.to_string()).unwrap()
}

pub(super) fn drain(receiver: &mut UnboundedReceiver<Value>, sent: &mut Vec<Value>) {
    while let Ok(message) = receiver.try_recv() {
        sent.push(message);
    }
}

pub(super) fn types(sent: &[Value]) -> Vec<&str> {
    sent.iter().map(|message| message["type"].as_str().unwrap()).collect()
}

macro_rules! harness {
    ($session:ident, $receiver:ident, $models:expr) => {
        let (sender, mut $receiver) = mpsc::unbounded_channel();
        let $session = VoiceSession::new("abc", sender, $models);
    };
}

#[tokio::test]
async fn hears_a_turn_answers_it_aloud_and_saves_it_once_playback_ends() {
    let fake = models(&[("It's three o'clock. Anything else today?", "", "")]);
    harness!(session, receiver, &fake);
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "audio.append", "sequence": 0, "audio": STANDARD.encode("pcm") }))).await;
    session.handle(&event(json!({ "type": "audio.commit" }))).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert_eq!(types(&sent), ["ready", "turn.ready", "transcript", "audio", "audio", "audio.done"]);
    assert_eq!(sent[2]["id"], "voice-abc-1");
    assert_eq!(sent[2]["text"], "what time is it");
    assert_eq!(sent[3]["itemId"], "item_voice-abc-1");
    session.handle(&event(json!({ "type": "playback.done" }))).await;
    drain(&mut receiver, &mut sent);
    assert_eq!(
        sent.last().unwrap(),
        &json!({ "type": "turn.done", "id": "voice-abc-1", "prompt": "what time is it", "reply": "It's three o'clock. Anything else today?", "interrupted": false })
    );
    // Each sentence is told its neighbours, so the delivery stays continuous.
    assert_eq!(
        *fake.spoken.lock().unwrap(),
        [
            ("It's three o'clock.".to_owned(), String::new(), "Anything else today?".to_owned()),
            ("Anything else today?".to_owned(), "It's three o'clock.".to_owned(), String::new()),
        ]
    );
}

#[tokio::test]
async fn hands_work_to_the_app_and_says_nothing_once_its_admitted() {
    let fake = models(&[("", "start_task", "make a playlist of the videos"), ("", "steer_task", "add more")]);
    harness!(session, receiver, &fake);
    session.handle(&event(json!({ "type": "context", "history": "[]", "task": "" }))).await;
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "text.commit", "text": "make a playlist of the videos" }))).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    let call = sent.iter().find(|message| message["type"] == "tool.call").unwrap().clone();
    assert_eq!(call["name"], "start_task");
    assert_eq!(call["instruction"], "make a playlist of the videos");
    assert_eq!(call["key"], "voice-abc-1:start_task");
    assert_eq!(call["callId"], "call_abc_1_1");
    session.handle(&event(json!({ "type": "tool.result", "callId": call["callId"], "invocationId": "invocation_1" }))).await;
    drain(&mut receiver, &mut sent);
    assert_eq!(sent.last().unwrap()["type"], "audio.done");
    session.handle(&event(json!({ "type": "playback.done" }))).await;
    drain(&mut receiver, &mut sent);
    assert_eq!(sent.last().unwrap()["type"], "turn.done");
    assert_eq!(sent.last().unwrap()["reply"], "");
    // The next steer names the task the app admitted.
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "text.commit", "text": "add more" }))).await;
    drain(&mut receiver, &mut sent);
    assert_eq!(sent.last().unwrap()["type"], "tool.call");
    assert_eq!(sent.last().unwrap()["name"], "steer_task");
    assert_eq!(sent.last().unwrap()["invocationId"], "invocation_1");
}

#[tokio::test]
async fn answers_get_context_from_the_chat_the_app_sent_without_asking_the_app() {
    let fake = models(&[("", "get_context", ""), ("You asked about Lisbon earlier.", "", "")]);
    harness!(session, receiver, &fake);
    session.handle(&event(json!({ "type": "context", "history": r#"[{"user":"trip to Lisbon"}]"#, "task": "invocation_9" }))).await;
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "text.commit", "text": "what did we talk about" }))).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert!(!sent.iter().any(|message| message["type"] == "tool.call"));
    assert!(fake.tools.lock().unwrap()[0].iter().any(|tool| tool == "start_task"));
    let second = serde_json::to_string(&fake.messages.lock().unwrap()[1]).unwrap();
    assert!(second.contains("trip to Lisbon"));
    assert!(second.contains("(Called get_context.)"));
}

#[tokio::test]
async fn reads_a_finished_task_aloud_with_no_tools_at_all() {
    let fake = models(&[("Your playlist is ready.", "", "")]);
    harness!(session, receiver, &fake);
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "task.read", "invocationId": "invocation_1", "result": "Made a playlist of 5 videos." }))).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert!(fake.tools.lock().unwrap()[0].is_empty());
    assert!(sent.iter().any(|message| message["type"] == "audio"));
    let asked = serde_json::to_string(&fake.messages.lock().unwrap()[0]).unwrap();
    assert!(asked.contains(r#"{\"invocation_id\":\"invocation_1\",\"result\":\"Made a playlist of 5 videos.\"}"#));
}

#[tokio::test]
async fn stops_speaking_when_the_person_interrupts_and_saves_the_turn_as_interrupted() {
    let fake = models(&[("A long answer.", "", "")]);
    harness!(session, receiver, &fake);
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "text.commit", "text": "tell me everything" }))).await;
    session.handle(&event(json!({ "type": "turn.cancel" }))).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert_eq!(sent.last().unwrap()["type"], "turn.done");
    assert_eq!(sent.last().unwrap()["interrupted"], true);
    assert_eq!(sent.last().unwrap()["reply"], "[Voice reply interrupted; unfinished speech omitted.]");
}

#[tokio::test]
async fn refuses_audio_out_of_order_and_ends_after_eight_turns() {
    let fake = models(&[]);
    harness!(out, out_receiver, &fake);
    out.handle(&event(json!({ "type": "turn.begin" }))).await;
    out.handle(&event(json!({ "type": "audio.append", "sequence": 3, "audio": "AAAA" }))).await;
    let mut sent = Vec::new();
    drain(&mut out_receiver, &mut sent);
    assert_eq!(sent.last().unwrap()["type"], "error");

    harness!(session, receiver, &fake);
    for turn in 0..9 {
        session.handle(&event(json!({ "type": "turn.begin" }))).await;
        if turn < 8 {
            session.handle(&event(json!({ "type": "text.commit", "text": "hi" }))).await;
            session.handle(&event(json!({ "type": "playback.done" }))).await;
        }
    }
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert_eq!(sent.last().unwrap()["type"], "session.expired");
}

#[tokio::test]
async fn protocol_errors_say_only_that_it_stopped() {
    let fake = models(&[]);
    harness!(session, receiver, &fake);
    for bad in [json!({ "type": "nope" }), json!(5), json!({ "type": "audio.commit" }), json!({ "type": "tool.result", "callId": "x" })] {
        session.handle(&event(bad)).await;
    }
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    let stopped = json!({ "type": "error", "message": "The voice session stopped. Your tasks and saved conversation are still available. Try voice again." });
    assert_eq!(&sent[1..], [stopped.clone(), stopped.clone(), stopped.clone(), stopped]);
}

#[tokio::test]
async fn a_second_turn_cannot_open_over_the_first_and_audio_cant_follow_a_commit() {
    let fake = models(&[]);
    harness!(session, receiver, &fake);
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert_eq!(types(&sent), ["ready", "turn.ready", "error"]);
    session.handle(&event(json!({ "type": "text.commit", "text": "x".repeat(4001) }))).await;
    session.handle(&event(json!({ "type": "audio.append", "sequence": 0, "audio": "AAAA" }))).await;
    sent.clear();
    drain(&mut receiver, &mut sent);
    assert_eq!(types(&sent), ["error", "error"]);
}

#[tokio::test]
async fn long_replies_are_cut_and_point_to_the_conversation() {
    let fake = FakeModels { replies: Mutex::new(VecDeque::new()), ..FakeModels::default() };
    let long = "word ".repeat(200);
    let leaked: &'static str = Box::leak(long.into_boxed_str());
    fake.replies.lock().unwrap().push_back((leaked, "", ""));
    harness!(session, receiver, &fake);
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "text.commit", "text": "go" }))).await;
    session.handle(&event(json!({ "type": "playback.done" }))).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    let reply = sent.last().unwrap()["reply"].as_str().unwrap().to_owned();
    assert!(reply.ends_with("word. The rest is in the conversation."));
    assert_eq!(reply.len(), 559 + ". The rest is in the conversation.".len());
}

#[tokio::test]
async fn tool_rounds_stop_after_three_and_the_turn_ends_quietly() {
    let fake = models(&[("", "get_context", ""), ("", "get_context", ""), ("", "get_context", ""), ("never said", "", "")]);
    harness!(session, receiver, &fake);
    session.handle(&event(json!({ "type": "turn.begin" }))).await;
    session.handle(&event(json!({ "type": "text.commit", "text": "go" }))).await;
    let mut sent = Vec::new();
    drain(&mut receiver, &mut sent);
    assert_eq!(fake.messages.lock().unwrap().len(), 3);
    assert_eq!(sent.last().unwrap()["type"], "audio.done");
    assert!(!sent.iter().any(|message| message["type"] == "audio"));
}

fn recorded() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/runtime_device/recorded.json")).unwrap()
}

#[test]
fn prompts_match_the_typescript_exactly() {
    let strings = recorded()["strings"].clone();
    assert_eq!(voice_instructions(r#"[{"a":1}]"#), strings["voiceInstructions"].as_str().unwrap());
    assert_eq!(VOICE_TASK_RESULT_PROMPT, strings["voiceTaskResultPrompt"].as_str().unwrap());
    assert_eq!(STANDARD.encode(wav(b"pcm!")), strings["wav"].as_str().unwrap());
}

#[test]
fn sentences_match_the_typescript_exactly() {
    for case in recorded()["strings"]["sentences"].as_array().unwrap() {
        let expected: Vec<String> = serde_json::from_value(case["pieces"].clone()).unwrap();
        assert_eq!(split_sentences(case["text"].as_str().unwrap()), expected, "{}", case["text"]);
    }
}
