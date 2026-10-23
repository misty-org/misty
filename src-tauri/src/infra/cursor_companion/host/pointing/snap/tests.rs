#[test]
fn labels_keep_only_the_words_that_name_a_control() {
    assert_eq!(
        super::label_words("Click the Save As button"),
        vec!["save", "as"]
    );
    assert!(super::label_words("tap here").is_empty());
}
