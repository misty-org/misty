//! `misty-app.json`: what an app is and what it asks for.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// What an app may ask for. A mod approves the list once, at install.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Permission {
    #[serde(rename = "files")]
    Files,
    #[serde(rename = "chat.post")]
    ChatPost,
    #[serde(rename = "rooms")]
    Rooms,
    #[serde(rename = "records")]
    Records,
    #[serde(rename = "members")]
    Members,
}

/// How an app's MCP server runs: `frame` in the app's own frame, `binary` as a program it ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpKind {
    Frame,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    /// The app's logo: its maker's own icon (an svg, png or webp), already on its tile.
    pub logo: String,
    /// The html file the frame opens.
    pub entry: String,
    /// Kinds of Space file the app opens, such as `image/*` or `.psd`.
    #[serde(default)]
    pub opens: Vec<String>,
    pub permissions: Vec<Permission>,
    #[serde(default)]
    pub mcp: Option<McpKind>,
    /// The app needs its own webview instead of a sandboxed frame.
    #[serde(default)]
    pub webview: bool,
    /// The app runs on an origin of its own (`misty-app://<id>`), so it has its own storage, may save downloads
    /// and is a secure context, which WebGPU needs. It still reaches Misty only through the SDK channel.
    #[serde(default)]
    pub own_origin: bool,
    /// The app's pages use inline scripts, which its policy otherwise refuses (an app built as one static page).
    #[serde(default)]
    pub inline_scripts: bool,
    /// Misty adds its Space-files shim to the app's entry page, so the app's own Open and Save reach the Space's
    /// Media without the app knowing the SDK. The app's files are not changed.
    #[serde(default)]
    pub shim: bool,
}

const MAX_MANIFEST_NAME: usize = 64;
const MAX_OPENS: usize = 64;

/// An app id, as the server stores it: lowercase letters, digits and hyphens, starting with a letter.
pub fn valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    (2..=63).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// A version is one path segment: letters, digits and `. _ + -`, starting with a letter or digit.
pub fn valid_version(version: &str) -> bool {
    let bytes = version.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-'))
}

/// A path inside a bundle: relative, `/`-separated, with no empty, `.` or `..` part.
pub fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.contains(['\\', ':', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

impl AppManifest {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let manifest: Self = serde_json::from_slice(bytes)
            .map_err(|error| format!("misty-app.json is not valid: {error}"))?;
        manifest.validate()?;
        Ok(manifest)
    }

    fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.id) {
            return Err("The app's id must be lowercase letters, digits and hyphens.".into());
        }
        if !valid_version(&self.version) {
            return Err("The app's version isn't one a folder can be named.".into());
        }
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > MAX_MANIFEST_NAME {
            return Err("The app needs a name of up to 64 characters.".into());
        }
        if !safe_relative(&self.entry) || !self.entry.ends_with(".html") {
            return Err("The app's entry must be an html file inside the bundle.".into());
        }
        if !safe_relative(&self.logo)
            || ![".svg", ".png", ".webp"].iter().any(|extension| self.logo.ends_with(extension))
        {
            return Err("The app's logo must be an svg, png or webp file inside the bundle.".into());
        }
        if self.opens.len() > MAX_OPENS || self.opens.iter().any(|kind| kind.is_empty() || kind.len() > 100) {
            return Err("The app lists too many kinds of file, or an empty one.".into());
        }
        let mut seen = HashSet::new();
        if !self.permissions.iter().all(|permission| seen.insert(*permission)) {
            return Err("The app lists a permission twice.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(extra: &str) -> String {
        format!(
            r#"{{"id":"photocraft","name":"PhotoCraft","version":"1.2.0","logo":"logo.svg","entry":"index.html","permissions":["files","chat.post"]{extra}}}"#
        )
    }

    #[test]
    fn a_manifest_parses_with_its_defaults() {
        let manifest = AppManifest::parse(json("").as_bytes()).unwrap();
        assert_eq!(manifest.permissions, vec![Permission::Files, Permission::ChatPost]);
        assert!(manifest.opens.is_empty() && manifest.mcp.is_none() && !manifest.webview);
        let full = AppManifest::parse(json(r#","opens":["image/*",".psd"],"mcp":"binary","webview":true"#).as_bytes()).unwrap();
        assert_eq!(full.mcp, Some(McpKind::Binary));
        assert!(full.webview);
    }

    #[test]
    fn a_manifest_that_could_escape_its_folder_or_ask_for_too_much_is_refused() {
        for bad in [
            json(r#","extra":1"#),
            json("").replace("photocraft", "Photo Craft"),
            json("").replace("1.2.0", "../1"),
            json("").replace("index.html", "../index.html"),
            json("").replace("index.html", "/index.html"),
            json("").replace("index.html", "index.js"),
            json("").replace("logo.svg", "logo.gif"),
            json("").replace(r#""files","chat.post""#, r#""files","files""#),
            json("").replace(r#""files""#, r#""root""#),
        ] {
            assert!(AppManifest::parse(bad.as_bytes()).is_err(), "{bad}");
        }
    }

    #[test]
    fn ids_versions_and_paths_are_checked() {
        assert!(valid_id("docs") && valid_id("photo-craft2"));
        assert!(!valid_id("a") && !valid_id("1docs") && !valid_id("Docs") && !valid_id("do cs"));
        assert!(valid_version("1.0.0") && valid_version("2027.1-beta+7"));
        assert!(!valid_version("") && !valid_version(".hidden") && !valid_version("a/b"));
        assert!(safe_relative("a/b.js") && !safe_relative("a//b") && !safe_relative("a/../b"));
        assert!(!safe_relative("C:/x") && !safe_relative("a\\b") && !safe_relative(""));
    }
}
