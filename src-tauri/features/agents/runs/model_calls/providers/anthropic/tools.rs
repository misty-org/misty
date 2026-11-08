//! Function tools and the tool choice. Ported from `anthropic-prepare-tools.ts`.
use serde_json::Value;

use super::{
    capabilities::Capabilities,
    request::unsupported,
    wire::{Tool, ToolChoiceBody},
};
use crate::model_calls::call::{CallOptions, ToolChoice, ToolDefinition};
use crate::model_calls::raw_json::RawJson;

fn function_tool<'a>(tool: &'a ToolDefinition, supports_strict: bool, warnings: &mut Vec<Value>) -> Tool<'a> {
    if !supports_strict {
        if let Some(strict) = tool.strict {
            warnings.push(unsupported(
                "strict",
                format!(
                    "Tool '{}' has strict: {strict}, but strict mode is not supported by this provider. The strict property will be ignored.",
                    tool.name
                ),
            ));
        }
    }
    Tool {
        name: &tool.name,
        description: tool.description.as_deref(),
        input_schema: &tool.input_schema,
        // Streams tool input as the model writes it, which every streaming call asks for.
        eager_input_streaming: Some(true),
        strict: tool.strict.filter(|_| supports_strict),
    }
}

pub(super) type PreparedTools<'a> = (Option<Vec<Tool<'a>>>, Option<ToolChoiceBody<'a>>, Vec<&'static str>, Vec<Value>);

pub(super) fn prepare_tools<'a>(
    options: &'a CallOptions,
    json_tool_schema: Option<&'a RawJson>,
    capabilities: &Capabilities,
    native_schema: bool,
) -> PreparedTools<'a> {
    let supports_strict = capabilities.supports_structured_output;
    let mut warnings = Vec::new();
    let mut betas = Vec::new();
    let mut tools: Vec<Tool<'a>> =
        options.tools.iter().map(|tool| function_tool(tool, supports_strict, &mut warnings)).collect();
    if let Some(schema) = json_tool_schema {
        tools.push(Tool {
            name: "json",
            description: Some("Respond with a JSON object."),
            input_schema: schema,
            eager_input_streaming: Some(true),
            strict: None,
        });
        let choice = ToolChoiceBody { kind: "any", name: None, disable_parallel_tool_use: Some(true) };
        return (Some(tools), Some(choice), betas, warnings);
    }
    if tools.is_empty() {
        return (None, None, betas, warnings);
    }
    if native_schema {
        betas.push("structured-outputs-2025-11-13");
    }
    let plain = |kind| ToolChoiceBody { kind, name: None, disable_parallel_tool_use: None };
    match &options.tool_choice {
        None => (Some(tools), None, betas, warnings),
        Some(ToolChoice::Auto) => (Some(tools), Some(plain("auto")), betas, warnings),
        Some(ToolChoice::Required) => (Some(tools), Some(plain("any")), betas, warnings),
        // Anthropic has no `none`, so the tools go instead.
        Some(ToolChoice::None) => (None, None, betas, warnings),
        Some(ToolChoice::Tool { tool_name }) => {
            let choice = ToolChoiceBody { kind: "tool", name: Some(tool_name), disable_parallel_tool_use: None };
            (Some(tools), Some(choice), betas, warnings)
        }
    }
}
