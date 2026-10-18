//! Moving legacy environment files into the per-target layout.

use super::*;

pub(super) fn migrate_server_file(workspace: &Workspace, target: Target) -> Result<()> {
    let legacy = legacy_path(workspace, target);
    if !legacy.is_file() {
        return Ok(());
    }
    let contents = fs::read_to_string(&legacy)
        .with_context(|| format!("could not read {}", legacy.display()))?;
    let mut grouped = BTreeMap::<&'static str, Vec<&str>>::new();
    let mut seen = BTreeSet::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (raw_name, _) = trimmed
            .split_once('=')
            .with_context(|| format!("unsupported line in {}", legacy.display()))?;
        let name = raw_name
            .trim()
            .strip_prefix("export ")
            .unwrap_or(raw_name.trim());
        if DEPRECATED_NAMES.contains(&name) {
            continue;
        }
        if !seen.insert(name.to_owned()) {
            bail!("{name} is defined more than once in {}", legacy.display());
        }
        grouped.entry(owner(name)?).or_default().push(line);
    }

    for &relative in grouped.keys() {
        let path = root(workspace, target).join(relative);
        if path.exists() {
            bail!(
                "migration would overwrite {}; merge it with {} before retrying",
                path.display(),
                legacy.display()
            );
        }
    }
    for spec in FILES {
        let path = root(workspace, target).join(spec.path);
        let lines = grouped.remove(spec.path).unwrap_or_default();
        if lines.is_empty() {
            continue;
        }
        let contents = format!("{}\n", lines.join("\n"));
        write_private(&path, contents.as_bytes())?;
    }
    fs::create_dir_all(root(workspace, target))?;
    secure_directories(&root(workspace, target))?;
    secure_directories(&workspace.server.join(".env"))?;
    read(workspace, target)?;
    fs::remove_file(&legacy)
        .with_context(|| format!("could not remove migrated file {}", legacy.display()))?;
    println!(
        "Migrated {} into .env/{}/.",
        legacy.display(),
        target.label()
    );
    Ok(())
}

pub(super) fn migrate_cli_file(workspace: &Workspace) -> Result<()> {
    let legacy = workspace.cli.join(".env");
    if !legacy.is_file() {
        return Ok(());
    }
    let contents = fs::read_to_string(&legacy)
        .with_context(|| format!("could not read {}", legacy.display()))?;
    let next = workspace.cli.join(".env.next");
    if next.exists() {
        bail!(
            "temporary migration path already exists: {}",
            next.display()
        );
    }
    let mut grouped = BTreeMap::<&str, Vec<&str>>::new();
    let mut seen = BTreeSet::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (raw_name, _) = trimmed
            .split_once('=')
            .with_context(|| format!("unsupported line in {}", legacy.display()))?;
        let name = raw_name
            .trim()
            .strip_prefix("export ")
            .unwrap_or(raw_name.trim());
        if !seen.insert(name.to_owned()) {
            bail!("{name} is defined more than once in {}", legacy.display());
        }
        if DEPRECATED_CLI_NAMES.contains(&name) {
            continue;
        }
        grouped.entry(cli_owner(name)?).or_default().push(line);
    }
    fs::create_dir_all(&next)?;
    for name in ["common.env", "release.env", "cloudflare.env"] {
        let lines = grouped.remove(name).unwrap_or_default();
        if lines.is_empty() {
            continue;
        }
        let body = format!("{}\n", lines.join("\n"));
        write_private(&next.join(name), body.as_bytes())?;
    }
    secure_directories(&next)?;
    fs::remove_file(&legacy)?;
    fs::rename(&next, &legacy)?;
    println!("Migrated CLI configuration into misty/cli/.env/.");
    Ok(())
}

pub(super) fn init_cli_files(workspace: &Workspace) -> Result<()> {
    let root = workspace.cli.join(".env");
    if root.is_file() {
        bail!(
            "legacy CLI environment must be migrated first: {}",
            root.display()
        );
    }
    for name in ["common.env", "release.env", "cloudflare.env"] {
        let path = root.join(name);
        if path.exists() {
            require_private_file(&path)?;
        }
    }
    if root.exists() {
        secure_directories(&root)?;
    }
    Ok(())
}

pub(super) fn read_cli_files(workspace: &Workspace) -> Result<BTreeMap<String, String>> {
    read_selected_cli_files(workspace, &["common.env", "release.env", "cloudflare.env"])
}

pub fn read_selected_cli_files(
    workspace: &Workspace,
    files: &[&str],
) -> Result<BTreeMap<String, String>> {
    let root = workspace.cli.join(".env");
    if root.is_file() {
        bail!(
            "legacy CLI environment must be migrated first: {}",
            root.display()
        );
    }
    if root.is_dir() {
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|ext| ext == "env")
                && !["common.env", "release.env", "cloudflare.env"]
                    .contains(&entry.file_name().to_string_lossy().as_ref())
            {
                bail!("unknown CLI environment file: {}", entry.path().display());
            }
        }
    }
    let mut values = BTreeMap::new();
    for &file in files {
        let path = root.join(file);
        if !path.exists() {
            continue;
        }
        require_private_file(&path)?;
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("could not read {}", path.display()))?;
        for item in dotenvy::from_read_iter(contents.as_bytes()) {
            let (name, value) = item.map_err(|_| {
                anyhow::anyhow!("could not parse {} (values omitted)", path.display())
            })?;
            if DEPRECATED_CLI_NAMES.contains(&name.as_str()) {
                continue;
            }
            let expected = cli_owner(&name)?;
            if expected != file {
                bail!("{name} belongs in misty/cli/.env/{expected}, not misty/cli/.env/{file}");
            }
            if values.insert(name.clone(), value).is_some() {
                bail!("{name} is defined more than once in the CLI environment");
            }
        }
    }
    Ok(values)
}
