//! The companion's spoken conversation (`src/voice/`). It runs in-process: the app connects
//! [`run_voice_session`]'s channels to the renderer, and they carry what the socket carried.
mod models;
mod prompt;
mod route;
mod session;
#[cfg(test)]
mod route_tests;
#[cfg(test)]
mod session_tests;
mod turn;

pub use models::DeviceVoiceModels;
pub use route::run_voice_session;
pub use session::{VoiceDecision, VoiceModels};
