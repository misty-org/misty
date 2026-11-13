//! This computer's own device identity: the key that signs an agent run's grants, and the checks
//! every job passes before it acts. Nothing here talks to a server.

#[cfg(desktop)]
pub mod agent_grants;
#[cfg(desktop)]
pub(crate) mod agent_jobs;
#[cfg(desktop)]
pub mod commands;
#[cfg(desktop)]
pub mod identity;
#[cfg(desktop)]
pub mod key;
#[cfg(desktop)]
pub mod records;
