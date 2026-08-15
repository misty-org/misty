use crate::error::{ApiError, ApiResult};

const SERVICE: &str = "misty.self-host.entitlement";
const ACCOUNT: &str = "current";
const MAX_TOKEN_BYTES: usize = 8 * 1024;

pub fn store(token: &str) -> ApiResult<()> {
    validate(token)?;
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(keyring_error)?
        .set_password(token)
        .map_err(keyring_error)
}

pub fn load() -> ApiResult<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(keyring_error)?;
    match entry.get_password() {
        Ok(token) => {
            validate(&token)?;
            Ok(Some(token))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(keyring_error(error)),
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

fn keyring_error(error: keyring::Error) -> ApiError {
    ApiError::Message(format!(
        "Could not access the self-host entitlement credential: {error}"
    ))
}
