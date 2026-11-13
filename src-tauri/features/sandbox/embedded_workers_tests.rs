//! The embedded document worker, run through the documents crate.
use documents::windows::process;
use std::sync::atomic::AtomicBool;

use super::builtin_worker;

#[test]
fn documents_are_parsed_by_the_confined_worker() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("notes.txt");
    std::fs::write(&path, "Quarterly notes\nRevenue grew.").unwrap();
    let stop = AtomicBool::new(false);
    let value = process(&path, &stop, builtin_worker).unwrap();
    let text = value["document"]["sections"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|section| section["text"].as_str())
        .collect::<String>();
    assert!(text.contains("Revenue grew."), "{value}");
}

#[test]
fn cancelled_runs_never_start() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("notes.txt");
    std::fs::write(&path, "text").unwrap();
    let stop = AtomicBool::new(true);
    assert!(process(&path, &stop, builtin_worker).is_err());
}
