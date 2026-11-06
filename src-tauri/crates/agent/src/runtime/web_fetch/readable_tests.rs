use super::*;

fn page(body: &str) -> String {
    format!("<!doctype html><html><head><title> Pricing </title><script>alert(1)</script></head><body>{body}</body></html>")
}

fn read(html: &str, content_type: &str, question: &str, limit: usize) -> ReadablePage {
    readable_page(html, content_type, question, limit).unwrap()
}

#[test]
fn keeps_the_content_and_drops_page_chrome() {
    let read = read(
        &page(concat!(
            "<nav><a>Home</a></nav><main><h1>Plans</h1><p>Pro is <b>$10</b> a month.</p><ul><li>Unlimited notes</li></ul>",
            "<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Team</td><td>$15</td></tr></table></main><footer>© 2026</footer>",
        )),
        "text/html; charset=utf-8",
        "",
        READABLE_LIMIT,
    );
    assert_eq!(read.title, "Pricing");
    assert_eq!(read.text, "# Plans\nPro is $10 a month.\n- Unlimited notes\nPlan | Price\nTeam | $15");
    for gone in ["Home", "2026", "alert"] {
        assert!(!read.text.contains(gone));
    }
    assert!(!read.truncated);
}

#[test]
fn keeps_prices_that_sit_in_plain_divs_and_spans_as_pricing_pages_draw_them() {
    let read = read(
        &page(concat!(
            r#"<div class="toggle"><button>Monthly</button><button>Yearly</button></div>"#,
            r#"<section><div class="card"><h3>Basic</h3><div class="price"><span class="sr-only">$10 per user/month</span>"#,
            r#"<span aria-hidden="true"><i>$</i><i>10</i> per user/month</span></div><div>Billed annually</div></div>"#,
            r#"<div class="card"><h3>Business</h3><div class="price">$16 <span>per user/month</span></div></div></section>"#,
            "<nav><div>Docs</div></nav>",
        )),
        "text/html",
        "",
        READABLE_LIMIT,
    );
    assert_eq!(read.text, "Monthly\nYearly\n### Basic\n$10 per user/month\nBilled annually\n### Business\n$16 per user/month");
}

#[test]
fn uses_the_whole_page_when_the_main_area_holds_only_a_little_of_it() {
    let read = read(
        &page("<main><p>Intro</p></main><div><div>Team</div><div>$12 a month</div></div><div><div>Pro</div><div>$30 a month</div></div>"),
        "text/html",
        "",
        READABLE_LIMIT,
    );
    assert!(read.text.contains("$12 a month"));
    assert!(read.text.contains("$30 a month"));
}

#[test]
fn returns_the_parts_of_a_long_page_that_match_the_question() {
    let filler: String = (0..400).map(|index| format!("<p>Unrelated paragraph number {index} about the company history.</p>")).collect();
    let read = read(
        &page(&format!("<article>{filler}<h2>Pricing</h2><p>The Business plan costs $24 per user per month.</p>{filler}</article>")),
        "text/html",
        "business plan price per user",
        2_000,
    );
    assert!(read.truncated);
    assert!(read.text.contains("The Business plan costs $24 per user per month."));
    assert!(js_len(&read.text) <= 2_000);
}

#[test]
fn passes_plain_text_through() {
    assert_eq!(read(r#"{"ok":true}"#, "application/json", "", READABLE_LIMIT).text, r#"{"ok":true}"#);
    let long = read(&"é".repeat(20), "text/plain", "", 10);
    assert_eq!((long.text.as_str(), long.truncated), ("é".repeat(10).as_str(), true));
}

#[test]
fn notes_the_billing_period_only_when_a_page_has_prices_and_names_one() {
    assert!(billing_note("Plus $10 per seat/month, billed annually").unwrap().contains("billing period"));
    assert_eq!(billing_note("Plus $10 per seat/month"), None);
    assert_eq!(billing_note("Billed monthly or yearly, ask sales"), None);
}

#[test]
fn sends_pages_a_fetch_cant_read_to_a_browser() {
    let long = "word ".repeat(200);
    assert_eq!(browser_note(200, &long), None);
    assert!(browser_note(404, &long).is_some());
    assert!(browser_note(200, "short").is_some());
    assert!(browser_note(200, &format!("{long} Please enable JavaScript")).is_some());
}

#[test]
fn nesting_deeper_than_any_stack_reads_without_trouble() {
    let deep = format!("<html><body>{}text{}</body></html>", "<div>".repeat(200_000), "</div>".repeat(200_000));
    assert_eq!(read(&deep, "text/html", "", READABLE_LIMIT).text, "text");
}

#[test]
fn close_tags_that_match_nothing_cost_nothing() {
    let html = format!("<html><body>{}{}</body></html>", "<a>".repeat(200_000), "</b>".repeat(200_000));
    let started = std::time::Instant::now();
    assert_eq!(read(&html, "text/html", "", 100).text, "");
    assert!(started.elapsed().as_secs() < 30);
}

#[test]
fn the_plain_entry_point_reads_a_page_and_a_page_with_no_element_fails() {
    assert_eq!(readable_text(&page("<p>Hi</p>"), "https://example.com/").unwrap().text, "Hi");
    assert_eq!(readable_text("just words", "https://example.com/"), Err(ReadableError::NoDocumentElement));
}

/// One page's result recorded from the TypeScript by `test/web-tools.record.test.ts`.
#[derive(serde::Deserialize)]
struct Recorded {
    page: String,
    #[serde(rename = "contentType")]
    content_type: String,
    question: String,
    limit: usize,
    result: Option<RecordedResult>,
}

#[derive(serde::Deserialize)]
struct RecordedResult {
    title: String,
    text: String,
    truncated: bool,
}

/// Where html5ever's tokenizer and htmlparser2's disagree, on pages the TypeScript read differently:
/// the title and text this reads instead. Comparing them here means a new difference fails the test
/// above, and one that goes away fails this one.
const KNOWN_DIFFERENCES: [(&str, &str, &str); 6] = [
    // htmlparser2 skips the space and closes the p; HTML5 makes `</ p>` a comment.
    ("known-close-tag-space.html", "Space in a close tag", "OneTwo"),
    // htmlparser2 runs a CDATA section to `]]>`; HTML5 ends it at the first `>` outside foreign content.
    ("known-cdata.html", "CDATA", "Before\nb ]]>\nAfter"),
    // HTML5 ends a comment at `--!>` as well as `-->`.
    ("known-comment-bang.html", "Comment end", "Before\nBetween\n-->\nAfter"),
    // HTML5 normalizes line endings before it tokenizes. Everywhere else whitespace collapses anyway.
    ("known-crlf-title.html", "Line one\nline two", "Body"),
    // Inside a title HTML5 turns NUL into a replacement character.
    ("known-nul.html", "Nul\u{FFFD} in title", "a\0b"),
    // linkedom keeps the attribute's case and looks up the lowercase name; the tokenizer lowercases.
    ("known-upper-attrs.html", "Upper attributes", "Kept"),
];

#[test]
#[allow(clippy::disallowed_methods)] // Test fixtures, not a path anything gave us.
fn matches_every_page_recorded_from_the_typescript() {
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/web_fetch");
    let recorded: Vec<Recorded> = serde_json::from_str(&std::fs::read_to_string(folder.join("readable.json")).unwrap()).unwrap();
    assert!(recorded.len() >= 60);
    let mut wrong = Vec::new();
    let mut known = 0;
    for case in recorded {
        let html = String::from_utf8_lossy(&std::fs::read(folder.join("pages").join(&case.page)).unwrap()).into_owned();
        let got = readable_page(&html, &case.content_type, &case.question, case.limit).ok();
        let matches = |title: &str, text: &str, truncated: bool| got.as_ref().is_some_and(|got| got.title == title && got.text == text && got.truncated == truncated);
        if let Some((_, title, text)) = KNOWN_DIFFERENCES.iter().find(|(page, _, _)| *page == case.page) {
            known += 1;
            let want = case.result.as_ref().unwrap();
            assert!(want.title != *title || want.text != *text, "{} no longer differs", case.page);
            assert!(matches(title, text, false), "{}: {got:?}", case.page);
            continue;
        }
        let same = match &case.result {
            None => got.is_none(),
            Some(want) => matches(&want.title, &want.text, want.truncated),
        };
        if !same {
            wrong.push(format!("{} (question {:?}, limit {}):\n  got  {got:?}\n  want {:?}", case.page, case.question, case.limit, case.result.as_ref().map(|want| (&want.title, &want.text, want.truncated))));
        }
    }
    assert_eq!(known, KNOWN_DIFFERENCES.len());
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}
