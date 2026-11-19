use super::*;

#[test]
fn ids_never_climb_out() {
    assert!(folder_name("conv_123-abc").is_ok());
    for bad in ["", "..", "a/b", "a\\b", ".hidden", "with space"] {
        assert!(folder_name(bad).is_err(), "{bad}");
    }
    assert!(folder_name(&"x".repeat(129)).is_err());
}

#[test]
fn scratch_lives_beside_the_database() {
    let db = Store::at("/tmp/misty-home/data/misty.db");
    assert_eq!(
        scratch_for(&db, "chat1").unwrap(),
        PathBuf::from("/tmp/misty-home/chats/chat1")
    );
    assert!(is_scratch(
        &db,
        Path::new("/tmp/misty-home/chats/chat1/src")
    ));
    assert!(is_scratch(&db, Path::new("/tmp/misty-home/runs/run1")));
    assert!(!is_scratch(&db, Path::new("/tmp/misty-home/chats")));
    assert!(!is_scratch(&db, Path::new("/tmp/misty-home/data")));
}
