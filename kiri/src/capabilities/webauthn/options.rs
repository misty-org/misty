//! What a page may ask for. The shim sends `PublicKeyCredential*Options` with
//! every BufferSource encoded as base64url; this turns them into requests the
//! authenticator can run, and refuses relying parties the caller does not own.

use super::{Attachment, CreateRequest, GetRequest};
use crate::{Caller, KiriError};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Deserializer};

/// Signature algorithms Kiri can describe back to the page (COSE identifiers).
pub(super) const ES256: i64 = -7;
pub(super) const EDDSA: i64 = -8;
pub(super) const RS256: i64 = -257;

/// Bytes the page sent as base64url.
#[derive(Debug, Clone, Default)]
struct Bytes(Vec<u8>);

impl<'de> Deserialize<'de> for Bytes {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        URL_SAFE_NO_PAD
            .decode(text.trim_end_matches('='))
            .map(Bytes)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateOptions {
    challenge: Bytes,
    rp: RelyingParty,
    user: User,
    #[serde(default)]
    pub_key_cred_params: Vec<Parameter>,
    #[serde(default)]
    exclude_credentials: Vec<Descriptor>,
    #[serde(default)]
    authenticator_selection: Option<Selection>,
    #[serde(default)]
    attestation: Option<String>,
}

#[derive(Deserialize)]
struct RelyingParty {
    #[serde(default)]
    id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct User {
    id: Bytes,
    name: String,
    #[serde(default)]
    display_name: String,
}

#[derive(Deserialize)]
struct Parameter {
    #[serde(rename = "type")]
    kind: String,
    alg: i64,
}

#[derive(Deserialize)]
struct Descriptor {
    #[serde(rename = "type")]
    kind: String,
    id: Bytes,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Selection {
    #[serde(default)]
    authenticator_attachment: Option<String>,
    #[serde(default)]
    resident_key: Option<String>,
    #[serde(default)]
    require_resident_key: Option<bool>,
    #[serde(default)]
    user_verification: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetOptions {
    challenge: Bytes,
    #[serde(default)]
    rp_id: Option<String>,
    #[serde(default)]
    allow_credentials: Vec<Descriptor>,
    #[serde(default)]
    user_verification: Option<String>,
}

fn invalid(what: &str) -> KiriError {
    KiriError::type_error(format!("Invalid {what}."))
}

/// The RP ID must be the caller's host or a registrable suffix of it, never a
/// public suffix such as `co.uk`.
pub(super) fn relying_party(caller: &Caller, requested: Option<String>) -> Result<String, KiriError> {
    let url = url::Url::parse(&caller.origin).map_err(|_| KiriError::security("Invalid origin."))?;
    let host = match url.host() {
        Some(url::Host::Domain(domain)) => domain.to_ascii_lowercase(),
        _ => return Err(KiriError::security("Passkeys need a domain name.")),
    };
    let rp_id = requested.map(|id| id.to_ascii_lowercase()).unwrap_or_else(|| host.clone());
    let owned = rp_id == host || host.ends_with(&format!(".{rp_id}"));
    let registrable = rp_id == "localhost" || psl::domain_str(&rp_id).is_some();
    if owned && registrable {
        Ok(rp_id)
    } else {
        Err(KiriError::security(format!("{rp_id} is not a valid relying party for {}.", caller.origin)))
    }
}

fn user_verification(value: Option<String>) -> String {
    match value.as_deref() {
        Some(value @ ("required" | "discouraged")) => value.to_owned(),
        _ => "preferred".to_owned(),
    }
}

fn credential_ids(list: Vec<Descriptor>) -> Vec<Vec<u8>> {
    list.into_iter()
        .filter(|descriptor| descriptor.kind == "public-key")
        .map(|descriptor| descriptor.id.0)
        .collect()
}

pub(super) fn create(caller: &Caller, args: serde_json::Value) -> Result<CreateRequest, KiriError> {
    let options: CreateOptions = serde_json::from_value(args).map_err(|_| invalid("creation options"))?;
    if options.challenge.0.is_empty() {
        return Err(invalid("challenge"));
    }
    if options.user.id.0.is_empty() || options.user.id.0.len() > 64 {
        return Err(invalid("user.id"));
    }
    let requested: Vec<i64> = options
        .pub_key_cred_params
        .iter()
        .filter(|parameter| parameter.kind == "public-key")
        .map(|parameter| parameter.alg)
        .collect();
    let algorithms = if options.pub_key_cred_params.is_empty() {
        vec![ES256, RS256]
    } else {
        requested.into_iter().filter(|alg| [ES256, EDDSA, RS256].contains(alg)).collect()
    };
    if algorithms.is_empty() {
        return Err(KiriError::not_supported("None of the requested algorithms are supported."));
    }
    let selection = options.authenticator_selection.unwrap_or_default();
    let resident_key = selection.resident_key.or_else(|| {
        selection
            .require_resident_key
            .map(|required| if required { "required" } else { "discouraged" }.to_owned())
    });
    Ok(CreateRequest {
        origin: caller.origin.clone(),
        rp_id: relying_party(caller, options.rp.id)?,
        challenge: options.challenge.0,
        user_id: options.user.id.0,
        user_name: options.user.name,
        user_display_name: options.user.display_name,
        algorithms,
        exclude: credential_ids(options.exclude_credentials),
        attachment: match selection.authenticator_attachment.as_deref() {
            Some("platform") => Some(Attachment::Platform),
            Some("cross-platform") => Some(Attachment::CrossPlatform),
            _ => None,
        },
        resident_key: match resident_key.as_deref() {
            Some(value @ ("required" | "preferred" | "discouraged")) => value.to_owned(),
            _ => "discouraged".to_owned(),
        },
        user_verification: user_verification(selection.user_verification),
        attestation: match options.attestation.as_deref() {
            Some(value @ ("direct" | "indirect" | "enterprise")) => value.to_owned(),
            _ => "none".to_owned(),
        },
    })
}

pub(super) fn get(caller: &Caller, args: serde_json::Value) -> Result<GetRequest, KiriError> {
    let options: GetOptions = serde_json::from_value(args).map_err(|_| invalid("request options"))?;
    if options.challenge.0.is_empty() {
        return Err(invalid("challenge"));
    }
    Ok(GetRequest {
        origin: caller.origin.clone(),
        rp_id: relying_party(caller, options.rp_id)?,
        challenge: options.challenge.0,
        allow: credential_ids(options.allow_credentials),
        user_verification: user_verification(options.user_verification),
    })
}
