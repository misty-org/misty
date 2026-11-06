//! Live transcription on this computer (`src/live/`): the desktop streams PCM16 per channel and
//! receives diarized segments. It runs in-process: the app connects [`run_live_session`]'s channels
//! to the renderer, and they carry what the socket carried.
mod captions;
mod credential;
#[cfg(test)]
mod credential_tests;
mod route;
mod segment;
mod session;
#[cfg(test)]
mod session_tests;
mod soniox;
mod soniox_stream;

pub use credential::open_soniox;
pub use route::{run_live_session, LIVE_MAX_MS};
pub use segment::LiveChannel;
pub use session::{LiveSessionSpec, SttError, SttEvent, SttEvents, SttFactory, SttStream};
pub use soniox::{GeneralContext, SonioxConfig, SonioxContext, SonioxResult, SonioxToken, SonioxTranslation, TranslationTerm};
pub use soniox_stream::SonioxFactory;
