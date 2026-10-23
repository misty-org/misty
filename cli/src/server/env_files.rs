//! Reading private dotenv files the server tooling owns.

use super::*;

pub(super) fn read_environment(path: &Path) -> Result<BTreeMap<String, String>> {
    let contents =
        fs::read_to_string(path).with_context(|| format!("could not read {}", path.display()))?;
    let mut values = BTreeMap::new();
    for item in dotenvy::from_read_iter(contents.as_bytes()) {
        let (name, value) = item
            .map_err(|_| anyhow::anyhow!("could not parse {} (values omitted)", path.display()))?;
        if values.insert(name.clone(), value).is_some() {
            bail!("{name} is defined more than once in {}", path.display());
        }
    }
    Ok(values)
}

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

pub(super) fn require_private_file(path: &Path) -> Result<()> {
    if !path.is_file() {
        bail!("required private file is missing: {}", path.display());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)?.permissions().mode() & 0o077;
        if mode != 0 {
            bail!(
                "{} must not be accessible by group or others",
                path.display()
            );
        }
    }
    Ok(())
}
