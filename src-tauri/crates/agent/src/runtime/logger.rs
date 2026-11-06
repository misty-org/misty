//! The `[misty-agent-runtime]` lines benchmarks read, with the same names and fields as the TypeScript
//! runtime's. They go to stderr unless the app gives a callback of its own.
use std::sync::Arc;

use super::js_json::JsValue;

pub type LogSink = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone, Default)]
pub struct Logger(Option<LogSink>);

impl Logger {
    pub fn to(sink: LogSink) -> Self {
        Self(Some(sink))
    }

    /// `[misty-agent-runtime] <name> <fields as JSON>`.
    pub(crate) fn line(&self, name: &str, fields: &JsValue) {
        self.text(&format!("{name} {}", fields.stringify()));
    }

    pub(crate) fn text(&self, text: &str) {
        let line = format!("[misty-agent-runtime] {text}");
        match &self.0 {
            Some(sink) => sink(&line),
            None => eprintln!("{line}"),
        }
    }
}
