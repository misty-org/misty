//! Text kept short for the model and the cards.

/// `value` cut to `limit` characters, ending in "…" when it was longer.
pub fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }
    let kept: String = value.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", kept.trim())
}
