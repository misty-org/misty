//! Output items opening and closing, and the summary parts of reasoning items.
use std::collections::BTreeMap;

use serde_json::{json, Map};

use super::{item_metadata, reasoning_metadata, text_metadata, ActiveReasoning, OngoingCall, ResponsesDecoder, SummaryState};
use crate::sdk::{
    providers::openai_responses::{
        chunk::{AddedItem, Caller, DoneItem},
        parallel::{expand_parallel_tool_call, is_undeclared_parallel_tool_call},
    },
    stream::StreamPart,
};

impl ResponsesDecoder {
    pub(super) fn item_added(&mut self, output_index: u64, item: AddedItem, out: &mut Vec<StreamPart>) {
        match item {
            AddedItem::FunctionCall { call_id, name, .. } => {
                let suppress = is_undeclared_parallel_tool_call(&name, &self.tools);
                if !suppress {
                    out.push(StreamPart::ToolInputStart { id: call_id.clone(), tool_name: name.clone(), provider_metadata: None });
                }
                self.ongoing_calls.insert(
                    output_index,
                    OngoingCall { name, call_id, suppress_input_streaming: suppress, buffered_deltas: Vec::new() },
                );
            }
            AddedItem::Message { id, phase } => {
                self.active_item_ids.insert(output_index, id.clone());
                self.active_phase = phase;
                out.push(StreamPart::TextStart { provider_metadata: text_metadata(&id, phase), id });
            }
            AddedItem::Reasoning { id, encrypted_content } => {
                self.active_item_ids.insert(output_index, id.clone());
                out.push(StreamPart::ReasoningStart {
                    id: format!("{id}:0"),
                    provider_metadata: reasoning_metadata(&id, encrypted_content.as_deref()),
                });
                self.active_reasoning.insert(
                    id,
                    ActiveReasoning {
                        encrypted_content,
                        summary_parts: BTreeMap::from([(0, SummaryState::Active)]),
                    },
                );
            }
            AddedItem::Other => {}
        }
    }

    pub(super) fn item_done(&mut self, output_index: u64, item: DoneItem, out: &mut Vec<StreamPart>) {
        match item {
            DoneItem::Message { id, phase } => {
                let item_id = self.resolved_item_id(id, Some(output_index));
                let phase = phase.or(self.active_phase.take());
                self.active_phase = None;
                out.push(StreamPart::TextEnd { provider_metadata: text_metadata(&item_id, phase), id: item_id });
                self.active_item_ids.remove(&output_index);
            }
            DoneItem::FunctionCall { id, call_id, name, arguments, namespace, caller, .. } => {
                let ongoing = self.ongoing_calls.remove(&output_index);
                self.has_function_call = true;
                let suppress = ongoing
                    .as_ref()
                    .map_or_else(|| is_undeclared_parallel_tool_call(&name, &self.tools), |call| call.suppress_input_streaming);
                if suppress {
                    if let Some(expanded) = expand_parallel_tool_call(&call_id, &name, &arguments, &self.tools, &id) {
                        for part in expanded {
                            if let StreamPart::ToolCall { tool_call_id, tool_name, input, .. } = &part {
                                out.push(StreamPart::ToolInputStart { id: tool_call_id.clone(), tool_name: tool_name.clone(), provider_metadata: None });
                                out.push(StreamPart::ToolInputDelta { id: tool_call_id.clone(), delta: input.clone(), provider_metadata: None });
                                out.push(StreamPart::ToolInputEnd { id: tool_call_id.clone(), provider_metadata: None });
                            }
                            out.push(part);
                        }
                        return;
                    }
                    out.push(StreamPart::ToolInputStart { id: call_id.clone(), tool_name: name.clone(), provider_metadata: None });
                    let buffered = ongoing.map(|call| call.buffered_deltas).unwrap_or_default();
                    if !buffered.is_empty() {
                        for delta in buffered {
                            out.push(StreamPart::ToolInputDelta { id: call_id.clone(), delta, provider_metadata: None });
                        }
                    } else if !arguments.is_empty() {
                        out.push(StreamPart::ToolInputDelta { id: call_id.clone(), delta: arguments.clone(), provider_metadata: None });
                    }
                }
                // Tool namespaces come back on both of these.
                out.push(StreamPart::ToolInputEnd {
                    id: call_id.clone(),
                    provider_metadata: namespace.as_ref().map(|namespace| json!({ "openai": { "namespace": namespace } })),
                });
                let mut own = Map::new();
                own.insert("itemId".into(), json!(id));
                if let Some(namespace) = namespace {
                    own.insert("namespace".into(), json!(namespace));
                }
                match caller {
                    Some(Caller::Direct) => {
                        own.insert("caller".into(), json!({ "type": "direct" }));
                    }
                    Some(Caller::Program { caller_id }) => {
                        own.insert("caller".into(), json!({ "type": "program", "callerId": caller_id }));
                    }
                    None => {}
                }
                out.push(StreamPart::ToolCall {
                    tool_call_id: call_id,
                    tool_name: name,
                    input: arguments,
                    provider_metadata: Some(json!({ "openai": own })),
                });
            }
            DoneItem::Reasoning { id, encrypted_content } => {
                let item_id = self.resolved_item_id(id, Some(output_index));
                if let Some(active) = self.active_reasoning.remove(&item_id) {
                    // The encrypted content arrives here, so this end carries it for the next turn.
                    for (summary_index, state) in active.summary_parts {
                        if state != SummaryState::Concluded {
                            out.push(StreamPart::ReasoningEnd {
                                id: format!("{item_id}:{summary_index}"),
                                provider_metadata: reasoning_metadata(&item_id, encrypted_content.as_deref()),
                            });
                        }
                    }
                }
                self.active_item_ids.remove(&output_index);
            }
            DoneItem::Other => {}
        }
    }

    pub(super) fn summary_part_added(&mut self, item_id: String, summary_index: u64, out: &mut Vec<StreamPart>) {
        // The first part's start came with the reasoning item itself.
        if summary_index == 0 {
            return;
        }
        let Some(active) = self.active_reasoning.get_mut(&item_id) else {
            return;
        };
        active.summary_parts.insert(summary_index, SummaryState::Active);
        for (index, state) in active.summary_parts.iter_mut() {
            if *state == SummaryState::CanConclude {
                out.push(StreamPart::ReasoningEnd {
                    id: format!("{item_id}:{index}"),
                    provider_metadata: item_metadata(&item_id),
                });
                *state = SummaryState::Concluded;
            }
        }
        out.push(StreamPart::ReasoningStart {
            id: format!("{item_id}:{summary_index}"),
            provider_metadata: reasoning_metadata(&item_id, active.encrypted_content.as_deref()),
        });
    }
}
