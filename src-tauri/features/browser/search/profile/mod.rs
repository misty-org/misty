//! Search engines and bangs as profile data: the first profile's `search` collection is seeded
//! with the default engine and this computer's custom `!bangs`.
#[cfg(desktop)]
mod records;
#[cfg(desktop)]
pub(crate) use records::seed_records;
