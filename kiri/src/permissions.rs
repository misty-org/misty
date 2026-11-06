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

/// A site's camera, microphone and location choices.
#[derive(Clone, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SitePermissions {
    pub camera: Decision,
    pub microphone: Decision,
    /// Choices saved before location existed read as Ask.
    #[serde(default)]
    pub location: Decision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaKind {
    Camera,
    Microphone,
    CameraAndMicrophone,
}

/// A permission a site can ask for.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionKind {
    Camera,
    Microphone,
    Location,
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
    lookup: impl Fn(&str) -> SitePermissions,
) -> Verdict {
    let (Some(top), Some(requester), Some(kind)) = (top_origin, requester_origin, kind) else {
        return Verdict::Deny;
    };
    let permissions = effective(&lookup(top), &lookup(requester));
    let requested = match kind {
        MediaKind::Camera => vec![permissions.camera],
        MediaKind::Microphone => vec![permissions.microphone],
        MediaKind::CameraAndMicrophone => vec![permissions.camera, permissions.microphone],
    };
    // A top-level allowance never silently grants capture to an embedded third party.
    decide(&requested, top == requester)
}

/// Decides a request for the device's location, by the same rules as capture.
pub fn location_verdict(
    top_origin: Option<&str>,
    requester_origin: Option<&str>,
    lookup: impl Fn(&str) -> SitePermissions,
) -> Verdict {
    let (Some(top), Some(requester)) = (top_origin, requester_origin) else {
        return Verdict::Deny;
    };
    let permissions = effective(&lookup(top), &lookup(requester));
    decide(&[permissions.location], top == requester)
}

/// The tab's block applies to everything embedded in it.
fn effective(top: &SitePermissions, requester: &SitePermissions) -> SitePermissions {
    let inherit = |top: Decision, requester: Decision| {
        if top == Decision::Block {
            Decision::Block
        } else {
            requester
        }
    };
    SitePermissions {
        camera: inherit(top.camera, requester.camera),
        microphone: inherit(top.microphone, requester.microphone),
        location: inherit(top.location, requester.location),
    }
}

fn decide(requested: &[Decision], same_origin: bool) -> Verdict {
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

    fn store(camera: Decision, microphone: Decision) -> impl Fn(&str) -> SitePermissions {
        move |origin| {
            if origin == SITE {
                SitePermissions {
                    camera,
                    microphone,
                    location: Decision::Ask,
                }
            } else {
                SitePermissions::default()
            }
        }
    }

    fn located(location: Decision) -> impl Fn(&str) -> SitePermissions {
        move |origin| SitePermissions {
            location: if origin == SITE {
                location
            } else {
                Decision::Ask
            },
            ..SitePermissions::default()
        }
    }

    #[test]
    fn location_follows_the_capture_rules() {
        let allowed = located(Decision::Allow);
        assert_eq!(
            location_verdict(Some(SITE), Some(SITE), &allowed),
            Verdict::Grant
        );
        // An allowance stays with its own site; embeds are asked.
        assert_eq!(
            location_verdict(Some(SITE), Some(AD), &allowed),
            Verdict::Prompt
        );
        let blocked = located(Decision::Block);
        assert_eq!(
            location_verdict(Some(SITE), Some(AD), &blocked),
            Verdict::Deny
        );
        assert_eq!(
            location_verdict(Some(SITE), Some(SITE), located(Decision::Ask)),
            Verdict::Prompt
        );
        assert_eq!(location_verdict(None, Some(SITE), &allowed), Verdict::Deny);
        // Camera and microphone choices say nothing about location.
        assert_eq!(
            location_verdict(
                Some(SITE),
                Some(SITE),
                store(Decision::Allow, Decision::Allow)
            ),
            Verdict::Prompt
        );
    }

    #[test]
    fn choices_saved_before_location_read_as_ask() {
        let saved: SitePermissions =
            serde_json::from_str(r#"{"camera":"allow","microphone":"block"}"#).unwrap();
        assert_eq!(saved.location, Decision::Ask);
    }

    #[test]
    fn stored_choices_become_engine_verdicts() {
        let allowed = store(Decision::Allow, Decision::Block);
        assert_eq!(
            media_verdict(Some(SITE), Some(SITE), Some(MediaKind::Camera), &allowed),
            Verdict::Grant
        );
        assert_eq!(
            media_verdict(
                Some(SITE),
                Some(SITE),
                Some(MediaKind::Microphone),
                &allowed
            ),
            Verdict::Deny
        );
        assert_eq!(
            media_verdict(
                Some(SITE),
                Some(SITE),
                Some(MediaKind::CameraAndMicrophone),
                &allowed
            ),
            Verdict::Deny
        );
        let unset = store(Decision::Ask, Decision::Ask);
        assert_eq!(
            media_verdict(Some(SITE), Some(SITE), Some(MediaKind::Camera), &unset),
            Verdict::Prompt
        );
    }

    #[test]
    fn embedded_frames_never_inherit_a_top_level_allowance() {
        let allowed = store(Decision::Allow, Decision::Allow);
        assert_eq!(
            media_verdict(Some(SITE), Some(AD), Some(MediaKind::Camera), &allowed),
            Verdict::Prompt
        );
    }

    #[test]
    fn a_top_level_block_covers_embedded_frames() {
        let blocked = store(Decision::Block, Decision::Ask);
        assert_eq!(
            media_verdict(Some(SITE), Some(AD), Some(MediaKind::Camera), &blocked),
            Verdict::Deny
        );
        assert_eq!(
            media_verdict(Some(SITE), Some(AD), Some(MediaKind::Microphone), &blocked),
            Verdict::Prompt
        );
    }

    #[test]
    fn unknown_origins_or_kinds_fail_closed() {
        let allowed = store(Decision::Allow, Decision::Allow);
        assert_eq!(
            media_verdict(None, Some(SITE), Some(MediaKind::Camera), &allowed),
            Verdict::Deny
        );
        assert_eq!(
            media_verdict(Some(SITE), None, Some(MediaKind::Camera), &allowed),
            Verdict::Deny
        );
        assert_eq!(
            media_verdict(Some(SITE), Some(SITE), None, &allowed),
            Verdict::Deny
        );
    }

    #[test]
    fn origins_keep_scheme_host_and_nondefault_port() {
        assert_eq!(
            canonical_origin("https://user:pass@EXAMPLE.com:443/path?q=x").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            canonical_origin("https://example.com:8443/").unwrap(),
            "https://example.com:8443"
        );
        assert!(canonical_origin("file:///tmp/x").is_err());
        assert!(canonical_origin("about:blank").is_err());
    }
}
