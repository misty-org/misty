//! How far a version has got, read from its GitHub release.

use anyhow::Result;
use serde_json::Value;

use crate::{process::CommandSpec, workspace::Workspace};

use super::{build, model::PUBLIC_REPOSITORY, state};

#[derive(Debug, PartialEq, Eq)]
pub enum Stage {
    NotStarted,
    /// A draft, with the systems still to upload: those this computer builds, and the rest.
    Draft {
        here: Vec<String>,
        elsewhere: Vec<String>,
    },
    Published,
}

pub fn stage(workspace: &Workspace, version: &str) -> Result<Stage> {
    let tag = format!("misty-v{version}");
    let Ok(view) = CommandSpec::new("gh")
        .args(["release", "view", &tag, "--repo", PUBLIC_REPOSITORY])
        .args(["--json", "isDraft,assets"])
        .capture(&workspace.misty)
    else {
        return Ok(Stage::NotStarted);
    };
    let view: Value = serde_json::from_str(&view)?;
    if view["isDraft"] != Value::Bool(true) {
        return Ok(Stage::Published);
    }
    let manifest = state::load_manifest(workspace, version, true)?;
    Ok(draft_stage(
        &view,
        &manifest.platforms,
        build::current_platforms().unwrap_or_default(),
    ))
}

fn draft_stage(view: &Value, platforms: &[String], local: &[&str]) -> Stage {
    let uploaded = |platform: &String| {
        let name = format!("release-{platform}.json");
        view["assets"]
            .as_array()
            .is_some_and(|assets| assets.iter().any(|asset| asset["name"] == name.as_str()))
    };
    let (here, elsewhere) = platforms
        .iter()
        .filter(|platform| !uploaded(platform))
        .cloned()
        .partition(|platform| local.contains(&platform.as_str()));
    Stage::Draft { here, elsewhere }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_draft_offers_what_this_computer_can_build_then_points_elsewhere() {
        let platforms = ["macos-universal".to_owned(), "windows-x86_64".to_owned()];
        let view = json!({ "assets": [{ "name": "misty-release-manifest.json" }] });
        assert_eq!(
            draft_stage(&view, &platforms, &["macos-universal"]),
            Stage::Draft {
                here: vec!["macos-universal".into()],
                elsewhere: vec!["windows-x86_64".into()],
            }
        );
        let view = json!({ "assets": [{ "name": "release-macos-universal.json" }] });
        assert_eq!(
            draft_stage(&view, &platforms, &["macos-universal"]),
            Stage::Draft {
                here: vec![],
                elsewhere: vec!["windows-x86_64".into()],
            }
        );
    }

    #[test]
    fn a_draft_with_every_system_uploaded_is_ready_to_publish() {
        let view = json!({ "assets": [{ "name": "release-windows-x86_64.json" }] });
        assert_eq!(
            draft_stage(&view, &["windows-x86_64".to_owned()], &["windows-x86_64"]),
            Stage::Draft {
                here: vec![],
                elsewhere: vec![],
            }
        );
    }
}
