//! The `[misty-agent-runtime]` lines benchmarks read, with the same names and fields as the TypeScript
//! runtime's. They go to stderr unless the app gives a callback of its own.
//!
//! The Node process's stderr went to `runtime.log`, so everything it printed reached benchmarks. Some
//! places here have no logger of their own (a device call, a voice session, a classifier), and they
//! use [`process_log`], which reaches the same callback.
use std::sync::{Arc, PoisonError, RwLock};

use super::js_json::JsValue;

pub type LogSink = Arc<dyn Fn(&str) + Send + Sync>;

static PROCESS_SINK: RwLock<Option<LogSink>> = RwLock::new(None);

/// `[misty-agent-runtime] <text>`, for code with no [`Logger`] of its own.
pub(crate) fn process_log(text: &str) {
    let sink = PROCESS_SINK.read().unwrap_or_else(PoisonError::into_inner).clone();
    Logger(sink).text(text);
}

#[derive(Clone, Default)]
pub struct Logger(Option<LogSink>);

impl Logger {
    pub fn to(sink: LogSink) -> Self {
        Self(Some(sink))
    }

    /// Sends [`process_log`]'s lines here too. A logger with no callback leaves them on stderr.
    pub(crate) fn use_for_process(&self) {
        if self.0.is_some() {
            *PROCESS_SINK.write().unwrap_or_else(PoisonError::into_inner) = self.0.clone();
        }
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

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[test]
    fn lines_with_no_logger_reach_the_apps_callback() {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        Logger::to(Arc::new(move |line: &str| sink.lock().unwrap().push(line.to_owned()))).use_for_process();
        process_log("condensed {}");
        assert!(lines.lock().unwrap().iter().any(|line| line == "[misty-agent-runtime] condensed {}"));
    }
}
