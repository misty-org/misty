//! Which frames are cross-origin to the top document, from the tab's and its sessions' frame trees.
use super::*;

/// Whether the top document's script can't reach the frame. An opaque origin ("null"),
/// as a sandboxed frame has, is cross-origin to everything.
fn cross_origin(frame: &Value, top: &str) -> bool {
    match frame["securityOrigin"].as_str() {
        Some("null") | None => true,
        Some(origin) => origin != top || top == "null",
    }
}

fn walk<'a>(node: &'a Value, out: &mut Vec<&'a Value>) {
    out.push(&node["frame"]);
    for child in node["childFrames"].as_array().into_iter().flatten() {
        walk(child, out);
    }
}

/// The top document's loader and its cross-origin frame documents, from the tab's frame
/// tree and those of its frame sessions. A frame runs in the session whose tree holds it,
/// not the tab's.
pub(super) fn cross_origin_frames(
    top: &Value,
    sessions: &[(String, Value)],
) -> Option<(String, Vec<Found>)> {
    let root = &top["frameTree"];
    let document = root["frame"]["loaderId"].as_str()?.to_owned();
    let top_origin = root["frame"]["securityOrigin"].as_str().unwrap_or("null");
    let mut remote = HashSet::new();
    let mut placed: Vec<(Option<&str>, &Value)> = Vec::new();
    for (session, tree) in sessions {
        let mut frames = Vec::new();
        walk(&tree["frameTree"], &mut frames);
        for frame in frames {
            if let Some(id) = frame["id"].as_str() {
                remote.insert(id);
            }
            placed.push((Some(session.as_str()), frame));
        }
    }
    let mut own = Vec::new();
    for child in root["childFrames"].as_array().into_iter().flatten() {
        walk(child, &mut own);
    }
    let own = own
        .into_iter()
        .filter(|frame| frame["id"].as_str().is_some_and(|id| !remote.contains(id)))
        .map(|frame| (None, frame));
    let found = own
        .chain(placed)
        .filter_map(|(session, frame)| {
            let url = frame["url"].as_str()?;
            if !(url.starts_with("https://") || url.starts_with("http://"))
                || url.len() > 2_048
                || !cross_origin(frame, top_origin)
            {
                return None;
            }
            Some(Found {
                target: Target {
                    session: session.map(str::to_owned),
                    frame: frame["id"].as_str()?.to_owned(),
                },
                document: frame["loaderId"].as_str()?.to_owned(),
                url: url.to_owned(),
            })
        })
        .collect();
    Some((document, found))
}
