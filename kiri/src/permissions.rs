//! Site permission rules for powerful features, shared by every engine.
//! Where choices are stored is the host's business; how a stored choice turns
//! into an engine verdict is decided here, the same way on every platform.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    #[default]
    Ask,
    Allow,
    Block,
}

/// A site's camera and microphone choices.
#[derive(Clone, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct MediaPermissions {
    pub camera: Decision,
    pub microphone: Decision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaKind {
    Camera,
    Microphone,
    CameraAndMicrophone,
}

/// What the engine should do with a request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Let the engine (or Kiri, where the engine has none) ask the user.
    Prompt,
    Grant,
    Deny,
}

/// `scheme://host[:port]` for HTTP(S) addresses; anything else is refused.
pub fn canonical_origin(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value).map_err(|_| "Invalid website address.")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Site permissions are available for HTTP and HTTPS websites.".into());
    }
    Ok(url.origin().ascii_serialization())
}

/// Decides a capture request. `lookup` returns the stored choices for an
/// origin. Requests whose origins or kind could not be established fail
/// closed.
pub fn media_verdict(
    top_origin: Option<&str>,
    requester_origin: Option<&str>,
    kind: Option<MediaKind>,
    lookup: impl Fn(&str) -> MediaPermissions,
) -> Verdict {
    let (Some(top), Some(requester), Some(kind)) = (top_origin, requester_origin, kind) else {
        return Verdict::Deny;
    };
    let permissions = effective(&lookup(top), &lookup(requester));
    // A top-level allowance never silently grants capture to an embedded third party.
    decide(&permissions, kind, top == requester)
}

/// The tab's block applies to everything embedded in it.
fn effective(top: &MediaPermissions, requester: &MediaPermissions) -> MediaPermissions {
    let inherit = |top: Decision, requester: Decision| {
        if top == Decision::Block {
            Decision::Block
        } else {
            requester
        }
    };
    MediaPermissions {
        camera: inherit(top.camera, requester.camera),
        microphone: inherit(top.microphone, requester.microphone),
    }
}

fn decide(permissions: &MediaPermissions, kind: MediaKind, same_origin: bool) -> Verdict {
    let requested = match kind {
        MediaKind::Camera => vec![permissions.camera],
        MediaKind::Microphone => vec![permissions.microphone],
        MediaKind::CameraAndMicrophone => vec![permissions.camera, permissions.microphone],
    };
    if requested.contains(&Decision::Block) {
        Verdict::Deny
    } else if same_origin && requested.iter().all(|value| *value == Decision::Allow) {
        Verdict::Grant
    } else {
        Verdict::Prompt
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SITE: &str = "https://meet.example";
    const AD: &str = "https://ads.example";

    fn store(camera: Decision, microphone: Decision) -> impl Fn(&str) -> MediaPermissions {
        move |origin| {
            if origin == SITE {
                MediaPermissions { camera, microphone }
            } else {
                MediaPermissions::default()
            }
        }
    }

    #[test]
    fn stored_choices_become_engine_verdicts() {
        let allowed = store(Decision::Allow, Decision::Block);
        assert_eq!(media_verdict(Some(SITE), Some(SITE), Some(MediaKind::Camera), &allowed), Verdict::Grant);
        assert_eq!(media_verdict(Some(SITE), Some(SITE), Some(MediaKind::Microphone), &allowed), Verdict::Deny);
        assert_eq!(media_verdict(Some(SITE), Some(SITE), Some(MediaKind::CameraAndMicrophone), &allowed), Verdict::Deny);
        let unset = store(Decision::Ask, Decision::Ask);
        assert_eq!(media_verdict(Some(SITE), Some(SITE), Some(MediaKind::Camera), &unset), Verdict::Prompt);
    }

    #[test]
    fn embedded_frames_never_inherit_a_top_level_allowance() {
        let allowed = store(Decision::Allow, Decision::Allow);
        assert_eq!(media_verdict(Some(SITE), Some(AD), Some(MediaKind::Camera), &allowed), Verdict::Prompt);
    }

    #[test]
    fn a_top_level_block_covers_embedded_frames() {
        let blocked = store(Decision::Block, Decision::Ask);
        assert_eq!(media_verdict(Some(SITE), Some(AD), Some(MediaKind::Camera), &blocked), Verdict::Deny);
        assert_eq!(media_verdict(Some(SITE), Some(AD), Some(MediaKind::Microphone), &blocked), Verdict::Prompt);
    }

    #[test]
    fn unknown_origins_or_kinds_fail_closed() {
        let allowed = store(Decision::Allow, Decision::Allow);
        assert_eq!(media_verdict(None, Some(SITE), Some(MediaKind::Camera), &allowed), Verdict::Deny);
        assert_eq!(media_verdict(Some(SITE), None, Some(MediaKind::Camera), &allowed), Verdict::Deny);
        assert_eq!(media_verdict(Some(SITE), Some(SITE), None, &allowed), Verdict::Deny);
    }

    #[test]
    fn origins_keep_scheme_host_and_nondefault_port() {
        assert_eq!(canonical_origin("https://user:pass@EXAMPLE.com:443/path?q=x").unwrap(), "https://example.com");
        assert_eq!(canonical_origin("https://example.com:8443/").unwrap(), "https://example.com:8443");
        assert!(canonical_origin("file:///tmp/x").is_err());
        assert!(canonical_origin("about:blank").is_err());
    }
}
