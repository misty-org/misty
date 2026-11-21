//! The notes an agent's engine wrote, read in place from each engine's own store.

use super::*;

pub(super) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub(super) fn warning_for(source: &str) -> String {
    match source {
        "project instructions" => "Couldn't read the project's instruction files.".into(),
        "Codex memory" => "Couldn't read Codex's memory.".into(),
        "Claude Code memory" => "Couldn't read Claude Code's memory.".into(),
        "Hermes memory" => "Couldn't read Hermes's memory.".into(),
        "Grok memory" => "Couldn't read Grok's memory.".into(),
        "Gemini CLI memory" => "Couldn't read Gemini CLI's memory.".into(),
        _ => format!("Couldn't read {source}."),
    }
}

pub(super) fn note_title(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Memory note".into());
    let parent = path
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned());
    parent.map_or(name.clone(), |parent| format!("{parent}/{name}"))
}

pub(super) fn add_file_note(
    path: &Path,
    source: &str,
    notes: &mut MemoryNotes,
    seen: &mut BTreeSet<PathBuf>,
) {
    if notes.notes.len() >= MAX_NOTE_FILES || !seen.insert(path.to_path_buf()) {
        return;
    }
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            let warning = warning_for(source);
            if !notes.errors.contains(&warning) {
                notes.errors.push(warning);
            }
            return;
        }
    };
    if !metadata.is_file() {
        return;
    }
    if metadata.len() > MAX_NOTE_BYTES {
        let warning = warning_for(source);
        if !notes.errors.contains(&warning) {
            notes.errors.push(warning);
        }
        return;
    }
    match std::fs::read_to_string(path) {
        Ok(content) => notes.notes.push(MemoryNote {
            id: format!("file:{}", path.to_string_lossy()),
            title: note_title(path),
            source: source.into(),
            content,
            deletable: true,
        }),
        Err(_) => {
            let warning = warning_for(source);
            if !notes.errors.contains(&warning) {
                notes.errors.push(warning);
            }
        }
    }
}

pub(super) fn add_markdown_tree(
    root: &Path,
    source: &str,
    notes: &mut MemoryNotes,
    seen: &mut BTreeSet<PathBuf>,
) {
    if notes.notes.len() >= MAX_NOTE_FILES {
        return;
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                let warning = warning_for(source);
                if !notes.errors.contains(&warning) {
                    notes.errors.push(warning);
                }
                continue;
            }
        };
        let mut paths = entries.flatten().map(|entry| entry.path()).collect::<Vec<_>>();
        paths.sort();
        for path in paths.into_iter().rev() {
            if notes.notes.len() >= MAX_NOTE_FILES {
                break;
            }
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                pending.push(path);
            } else if path
                .extension()
                .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("md"))
            {
                add_file_note(&path, source, notes, seen);
            }
        }
    }
}

/// The engine's project instruction files along the working-folder path, closest first.
pub(super) fn project_instructions(
    folder: Option<&Path>,
    notes: &mut MemoryNotes,
    seen: &mut BTreeSet<PathBuf>,
) {
    let Some(folder) = folder else { return };
    for parent in folder.ancestors().take(24) {
        for name in ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "GEMINI.md"] {
            add_file_note(&parent.join(name), "project instructions", notes, seen);
        }
    }
}

/// Claude Code keys automatic memory to its working folder's slug.
pub(super) fn claude_memory_dir(folder: &Path) -> Option<PathBuf> {
    let home = home_dir()?;
    let name: String = folder
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    Some(
        home.join(".claude")
            .join("projects")
            .join(name)
            .join("memory"),
    )
}

pub(super) fn codex_memory_db() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".codex")))
        .map(|home| home.join("memories_1.sqlite"))
}

pub(super) fn codex_notes(notes: &mut MemoryNotes) {
    let Some(path) = codex_memory_db() else { return };
    if !path.exists() {
        return;
    }
    let connection = match Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(connection) => connection,
        Err(_) => {
            notes.errors.push(warning_for("Codex memory"));
            return;
        }
    };
    let result = (|| -> rusqlite::Result<()> {
        let mut statement = connection.prepare(
            "SELECT thread_id, raw_memory, rollout_summary FROM stage1_outputs
             ORDER BY source_updated_at DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([MAX_NOTE_FILES as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            if notes.notes.len() >= MAX_NOTE_FILES {
                break;
            }
            let (thread, memory, summary) = row?;
            let content = format!(
                "{}{}{}",
                memory.trim(),
                if !memory.trim().is_empty() && !summary.trim().is_empty() {
                    "\n\n"
                } else {
                    ""
                },
                summary.trim()
            );
            if content.trim().is_empty() {
                continue;
            }
            if content.len() > MAX_NOTE_BYTES as usize {
                let warning = warning_for("Codex memory");
                if !notes.errors.contains(&warning) {
                    notes.errors.push(warning);
                }
                continue;
            }
            notes.notes.push(MemoryNote {
                id: format!("codex:{thread}"),
                title: format!("Memory from thread {thread}"),
                source: "Codex memory".into(),
                content,
                deletable: true,
            });
        }
        Ok(())
    })();
    if result.is_err() {
        notes.errors.push(warning_for("Codex memory"));
    }
}

pub(super) fn grok_slug(folder: &Path) -> Option<String> {
    let name = folder.file_name()?.to_string_lossy();
    Some(
        name.chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect(),
    )
}

/// Reads each source independently. A changed or inaccessible engine store is reported beside the
/// available notes instead of making recall or the notes page fail as a whole.
pub(crate) fn memory_notes(engine: &str, folder: Option<&Path>) -> MemoryNotes {
    let mut notes = MemoryNotes::default();
    let mut seen = BTreeSet::new();
    project_instructions(folder, &mut notes, &mut seen);
    let home = home_dir();
    match engine {
        "claude" => {
            if let Some(home) = &home {
                add_file_note(
                    &home.join(".claude/CLAUDE.md"),
                    "Claude Code memory",
                    &mut notes,
                    &mut seen,
                );
            }
            if let Some(folder) = folder.and_then(claude_memory_dir) {
                add_markdown_tree(&folder, "Claude Code memory", &mut notes, &mut seen);
            }
        }
        "codex" => {
            codex_notes(&mut notes);
            if let Some(home) = &home {
                add_file_note(
                    &home.join(".codex/AGENTS.md"),
                    "Codex memory",
                    &mut notes,
                    &mut seen,
                );
            }
        }
        "hermes" => {
            if let Some(home) = &home {
                let root = home.join(".hermes");
                add_file_note(
                    &root.join("SOUL.md"),
                    "Hermes memory",
                    &mut notes,
                    &mut seen,
                );
                add_markdown_tree(
                    &root.join("memories"),
                    "Hermes memory",
                    &mut notes,
                    &mut seen,
                );
            }
        }
        "grok" => {
            if let Some(home) = &home {
                let root = home.join(".grok/memory-v2");
                add_markdown_tree(
                    &root.join("global/topics"),
                    "Grok memory",
                    &mut notes,
                    &mut seen,
                );
                if let Some(slug) = folder.and_then(grok_slug) {
                    let workspaces = root.join("workspaces");
                    let entries = match std::fs::read_dir(workspaces) {
                        Ok(entries) => Some(entries),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                        Err(_) => {
                            notes.errors.push(warning_for("Grok memory"));
                            None
                        }
                    };
                    if let Some(entries) = entries {
                        for entry in entries {
                            let entry = match entry {
                                Ok(entry) => entry,
                                Err(_) => {
                                    notes.errors.push(warning_for("Grok memory"));
                                    continue;
                                }
                            };
                            let path = entry.path();
                            let name = entry.file_name().to_string_lossy().to_lowercase();
                            let metadata = match std::fs::symlink_metadata(&path) {
                                Ok(metadata) => metadata,
                                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                                    continue;
                                }
                                Err(_) => {
                                    notes.errors.push(warning_for("Grok memory"));
                                    continue;
                                }
                            };
                            let is_real_dir =
                                !metadata.file_type().is_symlink() && metadata.is_dir();
                            if is_real_dir
                                && (name == slug || name.starts_with(&format!("{slug}-")))
                            {
                                add_markdown_tree(
                                    &path.join("topics"),
                                    "Grok memory",
                                    &mut notes,
                                    &mut seen,
                                );
                            }
                        }
                    }
                }
            }
        }
        "gemini" => {
            if let Some(home) = &home {
                add_file_note(
                    &home.join(".gemini/GEMINI.md"),
                    "Gemini CLI memory",
                    &mut notes,
                    &mut seen,
                );
            }
            if let Some(folder) = folder {
                add_file_note(
                    &folder.join("GEMINI.md"),
                    "Gemini CLI memory",
                    &mut notes,
                    &mut seen,
                );
            }
        }
        _ => {
            if let Some(home) = &home {
                add_file_note(
                    &home.join(".agents/AGENTS.md"),
                    "project instructions",
                    &mut notes,
                    &mut seen,
                );
                add_file_note(
                    &home.join(".claude/CLAUDE.md"),
                    "project instructions",
                    &mut notes,
                    &mut seen,
                );
                add_file_note(
                    &home.join(".gemini/GEMINI.md"),
                    "project instructions",
                    &mut notes,
                    &mut seen,
                );
            }
        }
    }
    notes.notes.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    notes.errors.sort();
    notes.errors.dedup();
    notes
}

/// Deletes a listed note after a person's explicit confirmation. File paths are resolved again
/// from the current engine store; the caller cannot name an arbitrary local file to remove.
pub(crate) fn delete_memory_note(
    engine: &str,
    folder: Option<&Path>,
    id: &str,
) -> Result<(), String> {
    if engine == "codex" && id.starts_with("codex:") {
        let listed = memory_notes(engine, folder)
            .notes
            .into_iter()
            .any(|note| note.id == id && note.deletable);
        if !listed {
            return Err("This memory note is no longer available.".into());
        }
        let thread = id
            .strip_prefix("codex:")
            .filter(|id| !id.is_empty())
            .ok_or_else(|| "This memory note is no longer available.".to_string())?;
        let path = codex_memory_db().ok_or_else(|| "Couldn't find Codex's memory.".to_string())?;
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| warning_for("Codex memory"))?;
        let removed = connection
            .execute("DELETE FROM stage1_outputs WHERE thread_id = ?1", [thread])
            .map_err(|_| warning_for("Codex memory"))?;
        return if removed == 1 {
            Ok(())
        } else {
            Err("This memory note is no longer available.".into())
        };
    }
    let current = memory_notes(engine, folder);
    let note = current
        .notes
        .into_iter()
        .find(|note| note.id == id && note.deletable)
        .ok_or_else(|| "This memory note is no longer available.".to_string())?;
    let path = id
        .strip_prefix("file:")
        .map(PathBuf::from)
        .ok_or_else(|| "This memory note is no longer available.".to_string())?;
    // Protect against a symlink swap between listing and deletion.
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "This memory note is no longer available.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("This memory note is no longer available.".into());
    }
    std::fs::remove_file(path).map_err(|_| warning_for(&note.source))
}
