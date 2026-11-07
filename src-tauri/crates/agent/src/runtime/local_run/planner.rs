//! Builds what a local run starts from: its prompt and tools, out of the request the app sent.
use std::{collections::HashMap, sync::Arc};

use chrono::SecondsFormat;
use serde_json::{json, Value};

use super::RunPlanner;
use crate::runtime::{
    clock::now_ms,
    device_models::DeviceModelStore,
    local_prompt::{build_prompt, kept_notes, run_catalog, CatalogInputs, RunRequest},
    model_tools::CatalogTool,
    runtime_errors::RuntimeError,
};

pub(crate) struct PromptPlanner {
    pub(crate) models: Arc<DeviceModelStore>,
}

fn text<'a>(request: &'a Value, name: &str) -> &'a str {
    request.get(name).and_then(Value::as_str).unwrap_or("")
}

impl PromptPlanner {
    fn inputs(&self, request: &Value) -> CatalogInputs {
        let device_names: HashMap<String, String> = request
            .get("device_names")
            .and_then(Value::as_object)
            .map(|names| names.iter().filter_map(|(id, name)| Some((id.clone(), name.as_str()?.to_owned()))).collect())
            .unwrap_or_default();
        CatalogInputs {
            signed_in: request.get("signed_in").and_then(Value::as_bool).unwrap_or(false),
            composio_key: request.get("composio_key").and_then(Value::as_bool).unwrap_or(false),
            search: self.models.search().map(|saved| saved.provider),
            device_names,
        }
    }

    fn tools(&self, request: &Value) -> Vec<CatalogTool> {
        run_catalog(&RunRequest::from_json(request), &self.inputs(request))
    }
}

impl RunPlanner for PromptPlanner {
    fn context(&self, request: &Value, _device: &Value) -> Result<Value, RuntimeError> {
        let parsed = RunRequest::from_json(request);
        let tools: Vec<String> = self.tools(request).into_iter().map(|tool| tool.name).collect();
        // The app sends its own clock in the person's timezone: the prompt's dates are read in it.
        let now = match text(request, "now") {
            "" => chrono::DateTime::from_timestamp_millis(now_ms()).map(|at| at.to_rfc3339_opts(SecondsFormat::Secs, true)).unwrap_or_default(),
            now => now.to_owned(),
        };
        let built = build_prompt(&parsed, &tools, &now, text(request, "memory_context"), text(request, "method_guidance"));
        let mut context = json!({
            "system": built.system,
            "prompt": built.prompt,
            "title_prompt": built.title_prompt,
            "teach": built.teach,
            "teach_tool_budget": built.teach_tool_budget,
            "allowed_tools": tools,
        });
        if let Some((previous, turns)) = built.summary_request {
            context["summary_request"] = json!({ "previous": previous, "turns": turns });
        }
        if let Some(limit) = built.model_turn_limit {
            context["model_turn_limit"] = json!(limit);
        }
        if let Some(window) = built.context_window_tokens {
            context["context_window_tokens"] = json!(window);
        }
        // Handed to the loop as the app sent them.
        for name in ["capture", "display_captures", "attachments", "browser_replay"] {
            if let Some(value) = request.get(name).filter(|value| !value.is_null()) {
                context[name] = value.clone();
            }
        }
        Ok(context)
    }

    fn catalog(&self, request: &Value) -> Vec<CatalogTool> {
        self.tools(request)
    }

    fn notes(&self, request: &Value, summary: &str, model: &str) -> Option<Value> {
        kept_notes(&RunRequest::from_json(request), summary, model)
    }
}
