//! The shapes and checks every app tool call shares.
pub use super::types::*;

/// `GMAIL_SEND_EMAIL`
pub fn valid_tool_slug(slug: &str) -> bool {
    (3..=128).contains(&slug.len())
        && slug.starts_with(|character: char| character.is_ascii_uppercase())
        && slug
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}
