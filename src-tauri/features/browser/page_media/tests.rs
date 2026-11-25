use super::{act_script, read};

fn report(artwork: &str, position: &str) -> String {
    format!(
        r#"{{"active":true,"playing":true,"title":"Song","artist":"Band","album":"","artwork":"{artwork}","duration":200,"position":{position},"canPrevious":false,"canNext":true,"canSeek":true}}"#
    )
}

#[test]
fn reads_what_a_page_plays() {
    let media = read(&report("https://example.com/cover.jpg", "12.5")).unwrap();
    assert_eq!(media.title, "Song");
    assert_eq!(media.position, Some(12.5));
    assert_eq!(media.artwork, "https://example.com/cover.jpg");
}

#[test]
fn drops_artwork_that_isnt_https() {
    assert!(read(&report("http://example.com/cover.jpg", "1")).is_none());
    assert!(read(&report("javascript:alert(1)", "1")).is_none());
    assert!(read(&report("", "null")).is_some());
}

#[test]
fn drops_reports_it_cannot_trust() {
    assert!(read(&report("", "-4")).is_none());
    assert!(read(r#"{"active":true,"extra":1}"#).is_none());
    assert!(read(&"x".repeat(10_000)).is_none());
}

#[test]
fn acts_only_with_known_actions() {
    assert!(act_script("seekto", Some(30.0))
        .unwrap()
        .contains("\"seekto\", 30"));
    assert!(act_script("pause", None)
        .unwrap()
        .contains("\"pause\", null"));
    assert!(act_script("alert(1)", None).is_err());
    assert!(act_script("seekto", Some(f64::NAN)).is_err());
}
