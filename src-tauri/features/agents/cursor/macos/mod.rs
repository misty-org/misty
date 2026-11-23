pub(crate) mod accessibility;
pub(crate) mod companion_capture;
pub(crate) mod companion_pointing;
mod mist;
pub(crate) mod pointer;
pub(crate) mod pointer_actions;
pub(crate) mod ring;
pub(crate) mod ring_views;
pub(crate) mod screen_capture;
pub(crate) mod support;

#[cfg(test)]
#[path = "checks/agent_pointer.rs"]
mod agent_pointer_check;
