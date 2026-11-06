//! A browser cookie in the portable shape site data syncs and native engines exchange it in.
use serde::{Deserialize, Serialize};

use super::entities;
use crate::{Error, Result};

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
