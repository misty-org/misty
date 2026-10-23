use super::*;

#[test]
fn text_sections_preserve_line_citations_and_apply_caps() {
    let root = std::env::temp_dir().join(format!("misty-agent-doc-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let path = root.join("notes.md");
    fs::write(
        &path,
        (1..=620)
            .map(|line| format!("line {line}\n"))
            .collect::<String>(),
    )
    .unwrap();
    let prepared = prepare_document_sync(path.to_str().unwrap()).unwrap();
    assert_eq!(prepared.display_name, "notes.md");
    assert_eq!(prepared.sections[0].kind, "lines");
    assert_eq!(prepared.sections[0].locator, "1-500");
    assert_eq!(prepared.sections[1].locator, "501-620");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn csv_sections_preserve_sheet_ranges() {
    let root = std::env::temp_dir().join(format!("misty-agent-csv-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let path = root.join("totals.csv");
    fs::write(&path, "name,total\nAlpha,10\nBeta,20\n").unwrap();
    let prepared = prepare_document_sync(path.to_str().unwrap()).unwrap();
    assert_eq!(prepared.sections[0].kind, "sheet");
    assert_eq!(prepared.sections[0].locator, "Sheet1!A1:B3");
    assert!(prepared.sections[0].text.contains("Alpha\t10"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn image_files_fail_as_unsupported_content() {
    let root = std::env::temp_dir().join(format!("misty-agent-image-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let path = root.join("scan.png");
    fs::write(&path, [0x89, b'P', b'N', b'G']).unwrap();
    let error = prepare_document_sync(path.to_str().unwrap())
        .unwrap_err()
        .to_string();
    assert!(error.contains("unsupported_content"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn oversized_documents_are_rejected_before_reading() {
    let root = std::env::temp_dir().join(format!("misty-agent-large-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let path = root.join("large.txt");
    let file = fs::File::create(&path).unwrap();
    file.set_len(MAX_AGENT_DOCUMENT_BYTES + 1).unwrap();
    let error = prepare_document_sync(path.to_str().unwrap()).unwrap_err();
    assert!(error.to_string().contains("50 MiB"));
    let _ = fs::remove_dir_all(root);
}
