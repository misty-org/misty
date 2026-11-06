//! The context the server sends a run (`SpaceTaskContext` in `types.ts`). The TypeScript cast the body
//! unchecked, so here anything missing or of another type reads as absent, and the turn limit keeps
//! whatever came so it can be refused.
use crate::runtime::{
    companion_images::{DisplayCapture, TaskFile},
    js_json::JsValue,
    model_input::TaskInput,
    web_search::provider::SearchProviderId,
};

pub(crate) struct SpaceTaskContext {
    /// The whole body with the device's choices, for the run's file.
    pub(crate) raw: JsValue,
    pub(crate) model_id: String,
    pub(crate) reasoning_effort: String,
    pub(crate) system: String,
    pub(crate) prompt: String,
    pub(crate) teach: bool,
    pub(crate) teach_tool_budget: f64,
    pub(crate) display_captures: Vec<DisplayCapture>,
    pub(crate) capture: Option<TaskFile>,
    pub(crate) attachments: Vec<TaskFile>,
    pub(crate) model_turn_limit: Option<JsValue>,
    pub(crate) context_window_tokens: Option<f64>,
    pub(crate) allowed_tools: Vec<String>,
    pub(crate) device_search: Option<SearchProviderId>,
    pub(crate) title_prompt: String,
    pub(crate) summary_request: Option<(String, String)>,
    pub(crate) browser_replay: Option<JsValue>,
}

fn typed<T: serde::de::DeserializeOwned>(value: Option<&JsValue>) -> Option<T> {
    serde_json::from_str(&value?.stringify()).ok()
}

impl SpaceTaskContext {
    pub(crate) fn from_json(raw: JsValue) -> Self {
        let text = |name: &str| raw.get(name).and_then(JsValue::as_str).unwrap_or("").to_owned();
        let number = |name: &str| match raw.get(name) {
            Some(JsValue::Number(number)) => Some(*number),
            _ => None,
        };
        let summary = raw.get("summary_request").and_then(|request| {
            let turns = request.get("turns").and_then(JsValue::as_str).filter(|turns| !turns.is_empty())?;
            Some((request.get("previous").and_then(JsValue::as_str).unwrap_or("").to_owned(), turns.to_owned()))
        });
        let allowed_tools = raw.get("allowed_tools").and_then(JsValue::as_array).unwrap_or_default().iter().filter_map(JsValue::as_str).map(str::to_owned).collect();
        let device_search = match raw.get("device_search").and_then(JsValue::as_str) {
            Some("decodo") => Some(SearchProviderId::Decodo),
            Some("serper") => Some(SearchProviderId::Serper),
            _ => None,
        };
        Self {
            model_id: text("model_id"),
            reasoning_effort: text("reasoning_effort"),
            system: text("system"),
            prompt: text("prompt"),
            teach: !matches!(raw.get("teach"), None | Some(JsValue::Null | JsValue::Bool(false))),
            teach_tool_budget: number("teach_tool_budget").unwrap_or(0.0),
            display_captures: typed(raw.get("display_captures")).unwrap_or_default(),
            capture: typed(raw.get("capture")),
            attachments: typed(raw.get("attachments")).unwrap_or_default(),
            model_turn_limit: raw.get("model_turn_limit").cloned(),
            context_window_tokens: number("context_window_tokens"),
            allowed_tools,
            device_search,
            title_prompt: text("title_prompt"),
            summary_request: summary,
            browser_replay: raw.get("browser_replay").cloned(),
            raw,
        }
    }

    pub(crate) fn task_input(&self) -> TaskInput<'_> {
        TaskInput { prompt: &self.prompt, attachments: &self.attachments, capture: self.capture.as_ref(), display_captures: &self.display_captures }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_the_server_sends_and_keeps_a_bad_turn_limit_to_refuse() {
        let context = SpaceTaskContext::from_json(JsValue::parse(r#"{"model_id":"m/x","system":"S","prompt":"P","allowed_tools":["a"],"model_turn_limit":null,"summary_request":{"previous":"p","turns":"t"},"device_search":"serper"}"#).unwrap());
        assert_eq!(context.model_id, "m/x");
        assert_eq!(context.allowed_tools, ["a"]);
        assert_eq!(context.model_turn_limit, Some(JsValue::Null));
        assert_eq!(context.summary_request, Some(("p".to_owned(), "t".to_owned())));
        assert_eq!(context.device_search, Some(SearchProviderId::Serper));
    }

    #[test]
    fn a_summary_with_no_turns_is_no_summary() {
        let context = SpaceTaskContext::from_json(JsValue::parse(r#"{"summary_request":{"previous":"p","turns":""}}"#).unwrap());
        assert_eq!(context.summary_request, None);
    }
}
