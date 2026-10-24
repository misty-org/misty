use super::*;

fn read(url: &str, text: &str) -> FrameRead {
    FrameRead {
        url: url.into(),
        text: text.into(),
        skills: Vec::new(),
    }
}

#[test]
fn frames_land_under_the_iframe_that_shows_them() {
    let tree =
        "- heading \"Class Schedule\"\n  - iframe [cross-origin]\n- link \"Contact\" [ref=e4]";
    let spliced = splice_trees(
        tree,
        &[read(
            "https://studio.marianaiframes.com/schedule",
            "- button \"Lotus Room\" [ref=e1000001]",
        )],
    );
    assert_eq!(
            spliced,
            "- heading \"Class Schedule\"\n  - iframe [cross-origin] [url=https://studio.marianaiframes.com/schedule]:\n    - button \"Lotus Room\" [ref=e1000001]\n- link \"Contact\" [ref=e4]"
        );
}

#[test]
fn origins_match_before_order_and_strays_go_last() {
    let tree = "- iframe \"Map\" [cross-origin https://maps.example]\n- iframe \"Book\" [cross-origin https://book.example]";
    let frames = [
        read("https://book.example/widget", "- text: Tuesday 7 PM"),
        read("https://maps.example/embed", "- text: 12 Main St"),
        read("https://ads.example/x", "- text: Sale"),
    ];
    let spliced = splice_trees(tree, &frames);
    let lines: Vec<_> = spliced.lines().collect();
    assert_eq!(lines[1], "  - text: 12 Main St");
    assert_eq!(lines[3], "  - text: Tuesday 7 PM");
    assert_eq!(
        lines[4],
        "- iframe [cross-origin https://ads.example] [url=https://ads.example/x]:"
    );
}

#[test]
fn frames_add_a_bounded_amount() {
    let big = "- text: x\n".repeat(5_000);
    let frames = [
        read("https://a.example", &big),
        read("https://b.example", &big),
        read("https://c.example", &big),
    ];
    let spliced = splice_trees("- heading \"Page\"", &frames);
    // The budget counts frame text; indenting it under the iframe adds two characters a line.
    assert!(
        spliced.len() < FRAME_TREES_CHARS * 13 / 10,
        "{}",
        spliced.len()
    );
    assert!(
        append_markdown("# Page", &frames[..1]).contains("Embedded frame from https://a.example")
    );
    assert_eq!(
        shown_url("https://sandbox.example/pad/inner.html?ver=2#%7B%22cfg%22"),
        "https://sandbox.example/pad/inner.html?ver=2"
    );
}

#[test]
fn refs_route_to_their_frame_slot() {
    let tab = "misty-browser-test-routing";
    let first = slot_for(tab, 41);
    let second = slot_for(tab, 42);
    assert_eq!((first, second), (1, 2));
    assert_eq!(slot_for(tab, 41), 1, "a frame keeps its slot");
    remember_document(tab, 2, "doc-42");
    assert_eq!(frame_of(tab, "e2000007"), Some((42, "doc-42".into())));
    assert_eq!(frame_of(tab, "e17"), None, "top-document refs stay put");
    assert_eq!(
        frame_of(tab, "e5000001"),
        None,
        "an empty slot routes nowhere"
    );
    let skills = merge_skills(
        &json!([{"id": "grid"}]),
        &[FrameRead {
            skills: vec![json!({"id": "editor"}), json!({"id": "grid"})],
            ..read("https://pad.example", "- text: x")
        }],
    );
    assert_eq!(skills, json!([{"id": "grid"}, {"id": "editor"}]));
}
