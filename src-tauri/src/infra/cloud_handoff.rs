use serde::Deserialize;

const MAX_RESPONSE_BYTES: u64 = 1 << 20;

#[derive(Deserialize)]
pub struct RedeemedCloudCredential {
    pub connection_id: String,
    pub provider: String,
    pub access_token: String,
}

pub async fn redeem_cloud_credential(
    handoff: &str,
    redeem_url: &str,
) -> Result<RedeemedCloudCredential, String> {
    let redeem = validate_cloud_handoff_url(redeem_url)?;
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Cloud credential networking is unavailable.".to_owned())?
        .post(redeem)
        .json(&serde_json::json!({"handoff": handoff}))
        .send()
        .await
        .map_err(|_| "Cloud credential handoff failed.".to_owned())?
        .error_for_status()
        .map_err(|_| "Cloud credential handoff expired or was refused.".to_owned())?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES)
    {
        return Err("Cloud credential handoff response was invalid.".to_owned());
    }
    let response_bytes = response
        .bytes()
        .await
        .map_err(|_| "Cloud credential handoff response was invalid.".to_owned())?;
    if response_bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("Cloud credential handoff response was invalid.".to_owned());
    }
    serde_json::from_slice(&response_bytes)
        .map_err(|_| "Cloud credential handoff response was invalid.".to_owned())
}

fn validate_cloud_handoff_url(value: &str) -> Result<url::Url, String> {
    let redeem = url::Url::parse(value.trim())
        .map_err(|_| "Cloud credential handoff URL is invalid.".to_owned())?;
    let safe_transport = redeem.scheme() == "https"
        || (redeem.scheme() == "http"
            && redeem
                .host_str()
                .is_some_and(|host| host == "localhost" || host == "127.0.0.1" || host == "::1"));
    if !safe_transport || !redeem.path().ends_with("/cloud/handoffs/redeem") {
        return Err("Cloud credential handoff URL is not trusted.".to_owned());
    }
    Ok(redeem)
}

#[cfg(test)]
mod tests {
    use super::validate_cloud_handoff_url;

    #[test]
    fn redemption_requires_https_or_loopback_and_exact_api_path() {
        assert!(
            validate_cloud_handoff_url("https://api.misty.example/api/cloud/handoffs/redeem")
                .is_ok()
        );
        assert!(
            validate_cloud_handoff_url("http://127.0.0.1:8080/api/cloud/handoffs/redeem").is_ok()
        );
        assert!(
            validate_cloud_handoff_url("http://api.misty.example/api/cloud/handoffs/redeem")
                .is_err()
        );
        assert!(validate_cloud_handoff_url("https://evil.example/collect").is_err());
        assert!(validate_cloud_handoff_url("file:///tmp/handoff").is_err());
    }
}
