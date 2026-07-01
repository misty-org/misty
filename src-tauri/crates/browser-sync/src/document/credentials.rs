use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::entities;
use crate::{protocol::MAX_COUNTER, Error, Result};

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Area {
    Cookies,
    LocalStorage { origin: String },
    SessionStorage { origin: String, tab_id: String },
    IndexedDb { origin: String },
}

impl Area {
    /// Engine enumeration order and a domain cookie's optional leading dot are
    /// not semantic changes. Host-only scope remains part of identity.
    pub fn canonical_payload(&self, payload: &Value) -> Result<Value> {
        self.validate_payload(payload)?;
        if !matches!(self, Self::Cookies) {
            return Ok(payload.clone());
        }
        let mut cookies: Vec<Cookie> = serde_json::from_value(payload.clone())?;
        for cookie in &mut cookies {
            cookie.domain = cookie
                .domain
                .strip_prefix('.')
                .unwrap_or(&cookie.domain)
                .to_owned();
        }
        let mut encoded: Vec<String> = cookies
            .iter()
            .map(serde_json::to_string)
            .collect::<std::result::Result<_, _>>()?;
        encoded.sort();
        Ok(Value::Array(
            encoded
                .into_iter()
                .map(|value| serde_json::from_str(&value))
                .collect::<std::result::Result<_, _>>()?,
        ))
    }

    pub fn key(&self, profile: &str) -> Result<String> {
        if !entities::profile_id(profile) {
            return Err(Error::Invalid);
        }
        let origin = match self {
            Self::Cookies => None,
            Self::LocalStorage { origin }
            | Self::SessionStorage { origin, .. }
            | Self::IndexedDb { origin } => Some(origin),
        };
        if let Some(origin) = origin {
            entities::web_url(origin)?;
            if url::Url::parse(origin)
                .map_err(|_| Error::Invalid)?
                .origin()
                .ascii_serialization()
                != *origin
            {
                return Err(Error::Invalid);
            }
        }
        if let Self::SessionStorage { tab_id, .. } = self {
            if !entities::valid_id(tab_id) {
                return Err(Error::Invalid);
            }
        }
        // A canonical JSON tuple avoids delimiter collisions in origins/tab IDs.
        Ok(serde_json::to_string(&(profile, self))?)
    }

    pub fn validate_payload(&self, payload: &Value) -> Result<()> {
        match self {
            Self::Cookies => {
                let cookies: Vec<Cookie> = serde_json::from_value(payload.clone())?;
                if cookies.len() > 20_000 {
                    return Err(Error::TooLarge);
                }
                let mut keys = BTreeSet::new();
                for cookie in cookies {
                    cookie.validate()?;
                    let key = serde_json::to_string(&(
                        &cookie.name,
                        cookie.domain.strip_prefix('.').unwrap_or(&cookie.domain),
                        cookie.host_only,
                        &cookie.path,
                        &cookie.partition_key,
                    ))?;
                    if !keys.insert(key) {
                        return Err(Error::Invalid);
                    }
                }
            }
            Self::LocalStorage { .. } | Self::SessionStorage { .. } => {
                let entries: BTreeMap<String, String> = serde_json::from_value(payload.clone())?;
                if entries.len() > 50_000 {
                    return Err(Error::TooLarge);
                }
            }
            Self::IndexedDb { .. } => {
                // The native adapter owns the portable structured-clone codec.
                // Keep its version explicit; unexportable values must be reported
                // by capture rather than replaced with misleading empty records.
                let value: IndexedDbExport = serde_json::from_value(payload.clone())?;
                if value.codec_version != 1 || value.databases.len() > 256 {
                    return Err(Error::Invalid);
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SameSite {
    Strict,
    Lax,
    None,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartitionKey {
    pub top_level_site: String,
    pub has_cross_site_ancestor: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub host_only: bool,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<SameSite>,
    pub expires_unix_seconds: Option<i64>,
    pub partition_key: Option<PartitionKey>,
}

impl Cookie {
    pub fn validate(&self) -> Result<()> {
        if self.name.is_empty()
            || self.name.len() > 4096
            || self.value.len() > 65_536
            || self
                .name
                .bytes()
                .any(|b| b <= 32 || b >= 127 || b"()<>@,;:\\\"/[]?={}".contains(&b))
            || self.value.bytes().any(|b| matches!(b, 0 | b'\r' | b'\n'))
            || self.domain.len() > 253
            || self.path.len() > 4096
            || !self.path.starts_with('/')
            || self.path.bytes().any(|b| matches!(b, 0 | b'\r' | b'\n'))
        {
            return Err(Error::Invalid);
        }
        let domain = self.domain.strip_prefix('.').unwrap_or(&self.domain);
        let parsed = url::Url::parse(&format!("https://{domain}")).map_err(|_| Error::Invalid)?;
        if parsed.host_str() != Some(domain)
            || parsed.path() != "/"
            || parsed.port().is_some()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(Error::Invalid);
        }
        if self.host_only && self.domain.starts_with('.') {
            return Err(Error::Invalid);
        }
        if matches!(self.same_site, Some(SameSite::None)) && !self.secure {
            return Err(Error::Invalid);
        }
        if self.name.starts_with("__Secure-") && !self.secure {
            return Err(Error::Invalid);
        }
        if self.name.starts_with("__Host-") && (!self.secure || !self.host_only || self.path != "/")
        {
            return Err(Error::Invalid);
        }
        if let Some(partition) = &self.partition_key {
            entities::web_url(&partition.top_level_site)?;
            if !self.secure {
                return Err(Error::Invalid);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndexedDbExport {
    pub codec_version: u8,
    pub databases: Vec<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AreaUpdate {
    pub area: Area,
    pub base_sequence: u64,
    pub payload: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub profile_id: String,
    pub updates: Vec<AreaUpdate>,
}

impl Batch {
    pub fn validate(&self) -> Result<()> {
        if self.updates.is_empty() || self.updates.len() > 128 {
            return Err(Error::Invalid);
        }
        let mut keys = BTreeSet::new();
        for update in &self.updates {
            if update.base_sequence > MAX_COUNTER
                || !keys.insert(update.area.key(&self.profile_id)?)
            {
                return Err(Error::Invalid);
            }
            update.area.validate_payload(&update.payload)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_duplicate_engine_cookie_identity_with_domain_dot_alias() {
        let cookie = json!({
            "name": "session", "value": "synthetic", "domain": "example.test",
            "path": "/", "host_only": false, "secure": true, "http_only": true,
            "same_site": "lax", "expires_unix_seconds": null, "partition_key": null
        });
        let mut alias = cookie.clone();
        alias["domain"] = json!(".example.test");
        assert!(Area::Cookies
            .validate_payload(&json!([cookie.clone(), alias.clone()]))
            .is_err());

        // The same name/path can coexist at host-only and domain scope.
        let mut host_cookie = cookie;
        host_cookie["host_only"] = json!(true);
        assert!(Area::Cookies
            .validate_payload(&json!([host_cookie, alias]))
            .is_ok());
    }
}
