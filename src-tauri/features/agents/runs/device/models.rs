use crate::model_calls::{ModelError, ModelRoute};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeviceRole {
    Agent,
    Fast,
    Embedding,
    Transcription,
    Speech,
}

pub trait DeviceModels: Send + Sync {
    fn model_id(&self, role: DeviceRole) -> Option<String>;
    fn route(&self, model_id: &str) -> Result<ModelRoute, ModelError>;
    fn speech_voice(&self) -> Option<String> {
        None
    }
}
