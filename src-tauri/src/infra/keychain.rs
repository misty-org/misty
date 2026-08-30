use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rand::RngCore;

use crate::{
    error::{ApiError, ApiResult},
    infra::credential_store,
};

pub fn backup_repository_password(repository_id: &str) -> ApiResult<Option<String>> {
    let account = format!("repository:{repository_id}");
    credential_store::load("misty.backups", &account).map_err(|error| {
        ApiError::Message(format!("Could not read the backup credential: {error}"))
    })
}

pub fn store_backup_repository_password(repository_id: &str, password: &str) -> ApiResult<()> {
    if repository_id.is_empty() || password.len() < 24 {
        return Err(ApiError::Message(
            "Backup credential is invalid.".to_owned(),
        ));
    }
    credential_store::store(
        "misty.backups",
        &format!("repository:{repository_id}"),
        password,
    )
    .map_err(|error| ApiError::Message(format!("Could not store the backup credential: {error}")))
}

pub fn generate_backup_repository_password() -> String {
    generate_password()
}

fn generate_password() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    STANDARD_NO_PAD.encode(bytes)
}

const CODING_AI_KEY_SERVICE: &str = "misty.coding-ai.api-key";

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
