//! Private environment files: permissions, single-value updates, and the CLI files.

use super::*;

pub(super) fn require_private_file(path: &Path) -> Result<()> {
    #[cfg(windows)]
    if !misty_credential_store::is_private_file(path) {
        bail!("{} must be readable only by you", path.display());
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

pub(super) fn secure_directories(root: &Path) -> Result<()> {
    // Everything below inherits the folder's owner-only access.
    #[cfg(windows)]
    misty_credential_store::restrict_private_directory(root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for entry in WalkDir::new(root).min_depth(0).follow_links(false) {
            let entry = entry?;
            if entry.file_type().is_dir() {
                fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o700))?;
            }
        }
    }
    Ok(())
}

/// Update one registered setting without printing its value or replacing other settings.
pub fn set(workspace: &Workspace, target: Target, name: &str, value: &str) -> Result<()> {
    if value.contains(['\n', '\r', '\0']) {
        bail!("environment values must be single-line");
    }
    let owners = ownership()?;
    let relative = owners.get(name).context("unknown environment setting")?;
    let path = root(workspace, target).join(relative);
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => {
            require_private_file(&path)?;
            contents
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    let mut lines: Vec<String> = contents
        .lines()
        .filter(|line| {
            line.split_once('=').is_none_or(|(key, _)| {
                key.trim()
                    .strip_prefix("export ")
                    .unwrap_or(key.trim())
                    .trim()
                    != name
            })
        })
        .map(str::to_owned)
        .collect();
    // Single quoting prevents dotenv expansion of dollar signs in credentials.
    if value.contains('\'') {
        bail!("environment values cannot contain a single quote");
    }
    lines.push(format!("{name}='{value}'"));
    fs::create_dir_all(path.parent().context("environment path has no parent")?)?;
    secure_directories(&workspace.server.join(".env"))?;
    use std::io::Write;
    let mut temporary =
        tempfile::NamedTempFile::new_in(path.parent().context("environment path has no parent")?)?;
    temporary.write_all(format!("{}\n", lines.join("\n")).as_bytes())?;
    temporary.as_file().sync_all()?;
    temporary.persist(&path).map_err(|e| e.error)?;
    // Unix creates the temporary file private already.
    #[cfg(windows)]
    misty_credential_store::restrict_private_file(&path)?;
    Ok(())
}

pub(super) fn init_cli_files(workspace: &Workspace) -> Result<()> {
    let root = workspace.cli.join(".env");
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
