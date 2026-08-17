use crate::{
    error::{ApiError, ApiResult},
    infra::credential_store,
};

const SERVICE: &str = "misty.self-host.entitlement";
const ACCOUNT: &str = "current";
const MAX_TOKEN_BYTES: usize = 8 * 1024;

pub fn store(token: &str) -> ApiResult<()> {
    validate(token)?;
    credential_store::store(SERVICE, ACCOUNT, token).map_err(credential_error)
}

pub fn load() -> ApiResult<Option<String>> {
    match credential_store::load(SERVICE, ACCOUNT).map_err(credential_error)? {
        Some(token) => {
            validate(&token)?;
            Ok(Some(token))
        }
        None => Ok(None),
    }
}

fn validate(token: &str) -> ApiResult<()> {
    let trimmed = token.trim();
    if trimmed.len() < 32
        || trimmed.len() > MAX_TOKEN_BYTES
        || trimmed != token
        || trimmed.chars().any(char::is_whitespace)
        || trimmed.split('.').count() != 3
    {
        return Err(ApiError::Message(
            "The self-host entitlement proof is invalid.".to_owned(),
        ));
    }
    Ok(())
}

fn credential_error(error: credential_store::CredentialStoreError) -> ApiError {
    ApiError::Message(format!(
        "Could not access the self-host entitlement credential: {error}"
    ))
}
