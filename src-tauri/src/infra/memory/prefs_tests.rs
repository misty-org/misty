use rusqlite::Connection;

use super::prefs::{self, Remember};
use super::tests::{database, NOW};
use super::MemoryError;

fn remember(connection: &mut Connection, space: &str, agent: &str, content: &str) -> prefs::MemoryFact {
    let input = Remember {
        space_id: space.into(),
        agent_id: agent.into(),
        kind: "preference".into(),
        content: content.into(),
        ..Remember::default()
    };
    prefs::remember(connection, "me", input, NOW).unwrap()
}

#[test]
fn the_same_words_are_one_memory_per_agent_and_space() {
    let (_directory, mut connection) = database();
    let first = remember(&mut connection, "", "", "I like aisle seats");
    let again = remember(&mut connection, "", "", "  i LIKE aisle   seats ");
    assert_eq!(first.id, again.id);
    assert_eq!(prefs::list(&connection, "me", "", "", 0).unwrap().len(), 1);
    assert_ne!(remember(&mut connection, "", "writer", "I like aisle seats").id, first.id);
    assert_ne!(remember(&mut connection, "work", "", "I like aisle seats").id, first.id);
    assert_eq!(prefs::list(&connection, "me", "", "writer", 0).unwrap().len(), 1);
}

#[test]
fn a_memory_is_edited_and_forgotten_only_where_it_belongs() {
    let (_directory, mut connection) = database();
    let fact = remember(&mut connection, "", "", "Tea, no sugar");
    assert_eq!(
        prefs::update(&mut connection, "me", "work", "", &fact.id, "Coffee", NOW).unwrap_err(),
        MemoryError::NotFound
    );
    assert_eq!(
        prefs::update(&mut connection, "me", "", "writer", &fact.id, "Coffee", NOW).unwrap_err(),
        MemoryError::NotFound
    );
    prefs::update(&mut connection, "me", "", "", &fact.id, "Coffee", NOW + 1).unwrap();
    assert_eq!(prefs::list(&connection, "me", "", "", 0).unwrap()[0].content, "Coffee");
    assert_eq!(
        prefs::forget(&mut connection, "me", "", Some("writer"), &fact.id, NOW).unwrap_err(),
        MemoryError::NotFound
    );
    prefs::forget(&mut connection, "me", "", Some(""), &fact.id, NOW).unwrap();
    assert!(prefs::list(&connection, "me", "", "", 0).unwrap().is_empty());
    assert_eq!(
        prefs::forget(&mut connection, "me", "", Some(""), &fact.id, NOW).unwrap_err(),
        MemoryError::NotFound
    );
}

#[test]
fn a_memory_is_refused_when_too_long_or_of_an_unknown_kind() {
    let (_directory, mut connection) = database();
    let kept = |connection: &mut Connection, kind: &str, content: String| {
        let input = Remember { kind: kind.into(), content, ..Remember::default() };
        prefs::remember(connection, "me", input, NOW)
    };
    assert!(kept(&mut connection, "secret", "x".into()).is_err());
    assert!(kept(&mut connection, "fact", " ".into()).is_err());
    assert!(kept(&mut connection, "fact", "x".repeat(1001)).is_err());
    assert_eq!(kept(&mut connection, "", "x".repeat(1000)).unwrap().kind, "fact");
}

#[test]
fn context_says_when_each_memory_was_used() {
    let (_directory, mut connection) = database();
    let fact = remember(&mut connection, "", "", "Tea, no sugar");
    assert_eq!(fact.last_used_at, None);
    let context = prefs::context(&connection, "me", "", "", 0, NOW + 5).unwrap();
    assert_eq!(context.len(), 1);
    assert_eq!(
        prefs::list(&connection, "me", "", "", 0).unwrap()[0].last_used_at,
        Some(super::rfc3339(NOW + 5))
    );
}
