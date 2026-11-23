use std::sync::{Arc, PoisonError, RwLock};

use super::js_json::JsValue;

pub type LogSink = Arc<dyn Fn(&str) + Send + Sync>;

static PROCESS_SINK: RwLock<Option<LogSink>> = RwLock::new(None);

pub(crate) fn process_log(text: &str) {
    let sink = PROCESS_SINK
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    Logger(sink).text(text);
}

#[derive(Clone, Default)]
pub struct Logger(Option<LogSink>);

impl Logger {
    pub fn to(sink: LogSink) -> Self {
        Self(Some(sink))
    }

    pub(crate) fn use_for_process(&self) {
        if self.0.is_some() {
            *PROCESS_SINK.write().unwrap_or_else(PoisonError::into_inner) = self.0.clone();
        }
    }

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
        Logger::to(Arc::new(move |line: &str| {
            sink.lock().unwrap().push(line.to_owned())
        }))
        .use_for_process();
        process_log("condensed {}");
        assert!(lines
            .lock()
            .unwrap()
            .iter()
            .any(|line| line == "[misty-agent-runtime] condensed {}"));
    }
}
