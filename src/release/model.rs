use std::{fs, path::Path};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::artifacts;

pub const PUBLIC_REPOSITORY: &str = "misty-org/misty-public";
pub const RELEASE_MANIFEST_NAME: &str = "misty-release-manifest.json";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReleaseManifest {
    pub version: String,
    pub tag: String,
    pub source_commit: String,
    pub cli_commit: String,
    pub cli_version: String,
    pub config_sha256: String,
    pub created_at: DateTime<Utc>,
    pub platforms: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlatformManifest {
    pub version: String,
    pub tag: String,
    pub platform: String,
    pub source_commit: String,
    pub cli_commit: String,
    pub updater_asset: String,
    pub signature_asset: String,
    pub files: Vec<ArtifactRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ArtifactRecord {
    pub name: String,
    pub sha256: String,
    pub bytes: u64,
}

impl PlatformManifest {
    pub fn from_files(
        release: &ReleaseManifest,
        platform: &str,
        root: &Path,
        updater_asset: String,
        signature_asset: String,
    ) -> Result<Self> {
        let mut files = Vec::new();
        for path in artifacts::files_under(root)? {
            let name = path
                .file_name()
                .context("release artifact has no file name")?
                .to_string_lossy()
                .into_owned();
            files.push(ArtifactRecord {
                name,
                sha256: artifacts::sha256(&path)?,
                bytes: fs::metadata(&path)?.len(),
            });
        }
        files.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(Self {
            version: release.version.clone(),
            tag: release.tag.clone(),
            platform: platform.to_owned(),
            source_commit: release.source_commit.clone(),
            cli_commit: release.cli_commit.clone(),
            updater_asset,
            signature_asset,
            files,
        })
    }

    pub fn write(&self, path: &Path) -> Result<()> {
        fs::write(path, format!("{}\n", serde_json::to_string_pretty(self)?))
            .with_context(|| format!("could not write {}", path.display()))
    }

    pub fn read(path: &Path) -> Result<Self> {
        let contents = fs::read_to_string(path)
            .with_context(|| format!("could not read {}", path.display()))?;
        serde_json::from_str(&contents)
            .with_context(|| format!("could not parse {}", path.display()))
    }
}

impl ReleaseManifest {
    pub fn write(&self, path: &Path) -> Result<()> {
        fs::write(path, format!("{}\n", serde_json::to_string_pretty(self)?))
            .with_context(|| format!("could not write {}", path.display()))
    }

    pub fn read(path: &Path) -> Result<Self> {
        let contents = fs::read_to_string(path)
            .with_context(|| format!("could not read {}", path.display()))?;
        serde_json::from_str(&contents)
            .with_context(|| format!("could not parse {}", path.display()))
    }
}
