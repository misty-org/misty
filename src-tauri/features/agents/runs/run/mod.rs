//! The durable agent run: `workflows/*.ts`, with the Workflow library's durability in [`store`] and its
//! agent's one model turn in [`agent_step`].
pub(crate) mod agent_run;
pub(crate) mod agent_step;
pub(crate) mod context;
pub(crate) mod deps;
mod json_error;
mod finish_review;
pub(crate) mod model_call;
pub(crate) mod model_stream;
mod page_state;
pub(crate) mod run_ending;
pub(crate) mod run_start;
pub(crate) mod run_tools;
pub(crate) mod schema_check;
mod schema_collections;
mod schema_formats;
pub(crate) mod space_task_agent;
pub(crate) mod state;
pub(crate) mod step;
pub(crate) mod store;
pub(crate) mod tool_input;
mod turn_after;
mod turn_pacing;
mod turn_prepare;

#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod loop_tests;
#[cfg(test)]
mod run_resume_tests;
#[cfg(test)]
mod workflow_more_tests;
#[cfg(test)]
mod workflow_tests;
#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod parity_tests;
