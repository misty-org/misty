use crate::{
    error::{ApiError, ApiResult},
    infra::credential_store,
};

const CODING_AI_KEY_SERVICE: &str = "com.misty.coding-ai.api-key";

pub fn read_coding_ai_key(provider_id: &str) -> ApiResult<Option<String>> {
    credential_store::load(CODING_AI_KEY_SERVICE, provider_id)
        .map_err(|error| ApiError::Message(format!("Could not read API key: {error}")))
}

pub fn write_coding_ai_key(provider_id: &str, key: &str) -> ApiResult<()> {
    if provider_id.trim().is_empty() {
        return Err(ApiError::Message("Provider id is required".to_owned()));
    }
    credential_store::store(CODING_AI_KEY_SERVICE, provider_id, key)
        .map_err(|error| ApiError::Message(format!("Could not save API key: {error}")))
}

pub fn clear_coding_ai_key(provider_id: &str) -> ApiResult<()> {
    credential_store::delete(CODING_AI_KEY_SERVICE, provider_id)
        .map_err(|error| ApiError::Message(format!("Could not clear API key: {error}")))
}
