//! Which of this computer's models a call runs on. The app's document of keys and choices
//! (`device-models.ts`) sits behind this, so nothing here holds a key longer than one call.
use crate::sdk::{ModelError, ModelRoute};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeviceRole {
    Agent,
    Fast,
    Embedding,
    Transcription,
    Speech,
}

/// `deviceModelId` and `deviceRoute`.
pub trait DeviceModels: Send + Sync {
    /// The device's model for a role, with `fast` falling back to the agent model.
    fn model_id(&self, role: DeviceRole) -> Option<String>;
    /// The route a model runs on with this device's key for its provider.
    fn route(&self, model_id: &str) -> Result<ModelRoute, ModelError>;
}
