//! Reading values from the private dotenv files the server tooling owns.

use super::*;

pub(super) fn required_map_value<'a>(
    values: &'a BTreeMap<String, String>,
    name: &str,
) -> Result<&'a str> {
    values
        .get(name)
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("{name} is required"))
}
