use std::{fs, path::Path, time::SystemTime};

use anyhow::{Context, Result};
use serde_json::Value;
use walkdir::{DirEntry, WalkDir};

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

pub fn build(workspace: &Workspace) -> Result<bool> {
    let stamp = workspace
        .extensions
        .join(".build/official-apps/.development-ready");
    if development_packages_are_fresh(workspace, &stamp)? {
        println!("Misty official Apps are already up to date.");
        return Ok(false);
    }

    println!("Building Misty official Apps...");
    CommandSpec::new(npm())
        .args(["run", "build:official-apps"])
        .run(&workspace.misty)?;
    CommandSpec::new(npm())
        .args(["run", "package:official-apps"])
        .run(&workspace.extensions)?;
    CommandSpec::new(npm())
        .args(["run", "validate"])
        .run(&workspace.extensions)?;
    CommandSpec::new(npm())
        .args(["run", "sync:server-apps"])
        .run(&workspace.extensions)?;
    fs::write(&stamp, "ready\n").with_context(|| format!("could not write {}", stamp.display()))?;
    Ok(true)
}

fn development_packages_are_fresh(workspace: &Workspace, stamp: &Path) -> Result<bool> {
    if !development_outputs_exist(workspace)? {
        return Ok(false);
    }
    let stamp_time = match fs::metadata(stamp).and_then(|metadata| metadata.modified()) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(error).with_context(|| format!("could not read {}", stamp.display()))
        }
    };
    let inputs = [
        workspace.misty.join("src"),
        workspace.misty.join("vite.official-app.config.ts"),
        workspace
            .misty
            .join("scripts/build-official-app-packages.mjs"),
        workspace.misty.join("package.json"),
        workspace.misty.join("package-lock.json"),
        workspace.extensions.join("apps"),
        workspace.extensions.join("scripts/build-official-apps.mjs"),
        workspace.extensions.join("scripts/validate-catalog.mjs"),
        workspace
            .extensions
            .join("scripts/sync-server-official-apps.mjs"),
        workspace.extensions.join("package.json"),
        workspace.extensions.join("package-lock.json"),
        workspace.server.join("internal/appcatalog/catalog.go"),
    ];
    Ok(inputs
        .iter()
        .map(|path| newest_modified(path))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .all(|modified| modified <= stamp_time))
}

fn development_outputs_exist(workspace: &Workspace) -> Result<bool> {
    let catalog_path = workspace.extensions.join("apps/catalog.json");
    let catalog: Value = match fs::read(&catalog_path) {
        Ok(contents) => serde_json::from_slice(&contents)
            .with_context(|| format!("could not parse {}", catalog_path.display()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(error).with_context(|| format!("could not read {}", catalog_path.display()))
        }
    };
    let Some(apps) = catalog.get("apps").and_then(Value::as_array) else {
        return Ok(false);
    };
    if apps.is_empty() {
        return Ok(false);
    }
    for app in apps {
        let Some(id) = app.get("id").and_then(Value::as_str) else {
            return Ok(false);
        };
        let Some(version) = app.get("version").and_then(Value::as_str) else {
            return Ok(false);
        };
        let root = workspace
            .extensions
            .join("public/official-apps")
            .join(id)
            .join(version);
        if !root.join("desktop.zip").is_file() {
            return Ok(false);
        }
        if app.pointer("/mobile/runtime").and_then(Value::as_str) == Some("hosted")
            && (!root.join("app.js").is_file() || !root.join("app.css").is_file())
        {
            return Ok(false);
        }
    }
    Ok(workspace
        .server
        .join("internal/appcatalog/catalog.go")
        .is_file())
}

fn newest_modified(path: &Path) -> Result<Option<SystemTime>> {
    if path.is_file() {
        return fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .map(Some)
            .with_context(|| format!("could not inspect {}", path.display()));
    }
    if !path.exists() {
        return Ok(None);
    }
    let mut newest = None;
    for entry in WalkDir::new(path)
        .into_iter()
        .filter_entry(relevant_source_entry)
    {
        let entry = entry.with_context(|| format!("could not inspect {}", path.display()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let metadata = entry
            .metadata()
            .with_context(|| format!("could not inspect {}", entry.path().display()))?;
        let modified = metadata
            .modified()
            .with_context(|| format!("could not inspect {}", entry.path().display()))?;
        newest = Some(newest.map_or(modified, |current: SystemTime| current.max(modified)));
    }
    Ok(newest)
}

fn relevant_source_entry(entry: &DirEntry) -> bool {
    !matches!(
        entry.file_name().to_str(),
        Some("node_modules" | ".build" | "dist" | "target")
    )
}
