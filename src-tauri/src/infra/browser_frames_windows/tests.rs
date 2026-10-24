use super::*;

fn frame(id: &str, loader: &str, url: &str, origin: &str) -> Value {
    json!({"id": id, "loaderId": loader, "url": url, "securityOrigin": origin})
}

fn found(session: Option<&str>, frame: &str, document: &str, url: &str) -> Found {
    Found {
        target: Target {
            session: session.map(str::to_owned),
            frame: frame.into(),
        },
        document: document.into(),
        url: url.into(),
    }
}

#[test]
fn lists_cross_origin_frames_where_they_run() {
    let top = json!({"frameTree": {
        "frame": frame("top", "L0", "https://studio.example/schedule", "https://studio.example"),
        "childFrames": [
            {"frame": frame("same", "L1", "https://studio.example/nav", "https://studio.example")},
            {"frame": frame("site", "L2", "https://book.studio.example/w", "https://book.studio.example"),
             "childFrames": [{"frame": frame("blank", "L3", "about:blank", "https://book.studio.example")}]},
            {"frame": frame("oopif", "L4", "https://widget.example/x", "https://widget.example")},
            {"frame": frame("sandbox", "L5", "https://studio.example/sandboxed", "null")}
        ]
    }});
    let sessions = [(
        "S1".to_owned(),
        json!({"frameTree": {
            "frame": frame("oopif", "L6", "https://widget.example/x", "https://widget.example"),
            "childFrames": [{"frame": frame("inner", "L7", "https://widget.example/inner", "https://widget.example")}]
        }}),
    )];
    let (document, frames) = cross_origin_frames(&top, &sessions).unwrap();
    assert_eq!(document, "L0");
    assert_eq!(
        frames,
        vec![
            found(None, "site", "L2", "https://book.studio.example/w"),
            found(None, "sandbox", "L5", "https://studio.example/sandboxed"),
            found(Some("S1"), "oopif", "L6", "https://widget.example/x"),
            found(Some("S1"), "inner", "L7", "https://widget.example/inner"),
        ],
        "same-origin and non-web frames are left out, and a frame runs in its own session"
    );
    assert!(cross_origin_frames(&json!({}), &[]).is_none());
}

#[test]
fn frame_ids_last_as_long_as_their_document() {
    let mut tab = Tab::default();
    let a = found(None, "a", "L1", "https://a.example/");
    let b = found(Some("S1"), "b", "L2", "https://b.example/");
    let first = tab.reconcile("top-1", vec![a.clone(), b.clone()]);
    let again = tab.reconcile("top-1", vec![b.clone(), a.clone()]);
    assert_eq!(first, again, "ids and order hold while the documents do");
    let reloaded = found(None, "a", "L9", "https://a.example/");
    let after = tab.reconcile("top-1", vec![reloaded, b.clone()]);
    assert_eq!(after[0], first[1]);
    assert!(
        after[1].id > first[1].id,
        "a reloaded frame counts as the newest"
    );
    assert_eq!(tab.target(after[0].id), Some(b.target.clone()));
    assert_eq!(tab.target(first[0].id), None);
    let next_page = tab.reconcile("top-2", vec![b]);
    assert!(next_page[0].id > after[1].id, "a new page starts afresh");
    let many: Vec<_> = (0..30)
        .map(|n| {
            found(
                None,
                &format!("f{n}"),
                "L",
                &format!("https://{n}.example/"),
            )
        })
        .collect();
    let capped = tab.reconcile("top-2", many);
    assert_eq!(capped.len(), MAX_FRAMES);
    assert_eq!(capped[0].url, "https://6.example/", "the oldest go first");
}

#[test]
fn follows_frame_sessions_as_they_attach_and_detach() {
    let mut tab = Tab::default();
    let attached = |session: &str, kind: &str| json!({"sessionId": session, "targetInfo": {"type": kind, "targetId": "T"}, "waitingForDebugger": false});
    assert_eq!(
        tab.event(ATTACHED, &attached("S1", "iframe")),
        Some("S1".into())
    );
    assert_eq!(tab.event(ATTACHED, &attached("S2", "worker")), None);
    assert_eq!(
        tab.event(ATTACHED, &attached("S3", "iframe")),
        Some("S3".into())
    );
    assert_eq!(
        tab.event(ATTACHED, &attached("S1", "iframe")),
        Some("S1".into())
    );
    assert_eq!(tab.sessions, ["S1", "S3"]);
    assert_eq!(
        tab.event(DETACHED, &json!({"sessionId": "S1", "targetId": "T"})),
        None
    );
    assert_eq!(tab.sessions, ["S3"]);
    for n in 0..MAX_SESSIONS + 5 {
        tab.event(ATTACHED, &attached(&format!("N{n}"), "iframe"));
    }
    assert_eq!(tab.sessions.len(), MAX_SESSIONS);
    assert_eq!(tab.sessions.last().map(String::as_str), Some("N68"));
}
