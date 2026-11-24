// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/history/reader.rs.
use super::SessionMeta;
use std::sync::Arc;

fn query_rows<T>(
    db: &crate::engines::support::db::Db,
    sql: &str,
    map_row: impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, String> {
    let conn = db.read();
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_row).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        match row {
            Ok(value) => out.push(value),
            Err(e) => eprintln!("[history] skipping undecodable row: {e}"),
        }
    }
    Ok(out)
}

pub(crate) fn list_sessions_from(
    db: &crate::engines::support::db::Db,
) -> Result<Vec<SessionMeta>, String> {
    query_rows(
        db,
        "SELECT s.engine, s.session_id, s.workspace_path, s.file_path, s.file_size, s.file_mtime_ms,
                s.title, s.preview, s.created_at, s.updated_at, s.message_count, s.pinned, s.custom_title
         FROM cli_sessions s
         ORDER BY COALESCE(s.updated_at, 0) DESC",
        |r| {
            Ok(SessionMeta {
                engine: r.get(0)?,
                session_id: r.get(1)?,
                workspace_path: r.get(2)?,
                file_path: r.get(3)?,
                file_size: r.get(4)?,
                file_mtime_ms: r.get(5)?,
                title: r.get(6)?,
                preview: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
                message_count: r.get(10)?,
                pinned: r.get::<_, i64>(11)? != 0,
                custom_title: r.get(12)?,
            })
        },
    )
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, crate::engines::support::EngineState>,
) -> Result<Vec<SessionMeta>, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || list_sessions_from(&db))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_session(
    state: tauri::State<'_, crate::engines::support::EngineState>,
    engine: String,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    let sink = Arc::clone(&state.sink);
    tauri::async_runtime::spawn_blocking(move || {
        rename_session_in(&db, &engine, &session_id, &title)
    })
    .await
    .map_err(|e| e.to_string())??;
    sink.emit_sessions_changed();
    Ok(())
}

fn rename_session_in(
    db: &crate::engines::support::db::Db,
    engine: &str,
    session_id: &str,
    title: &str,
) -> Result<(), String> {
    let value = if title.trim().is_empty() {
        None
    } else {
        Some(title.trim())
    };
    let changed =
        db.0.lock()
            .execute(
                "UPDATE cli_sessions SET custom_title=?3 WHERE engine=?1 AND session_id=?2",
                rusqlite::params![engine, session_id, value],
            )
            .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("CCGUI_SESSION_NOT_FOUND".to_string());
    }
    Ok(())
}

fn session_file(
    db: &crate::engines::support::db::Db,
    engine: &str,
    session_id: &str,
) -> Option<String> {
    db.read()
        .query_row(
            "SELECT file_path FROM cli_sessions WHERE engine=?1 AND session_id=?2",
            rusqlite::params![engine, session_id],
            |r| r.get(0),
        )
        .ok()
}

pub async fn read_session(
    state: tauri::State<'_, crate::engines::support::EngineState>,
    engine: String,
    session_id: String,
) -> Result<Vec<super::Message>, String> {
    let db = Arc::clone(&state.db);
    let sink = Arc::clone(&state.sink);
    tauri::async_runtime::spawn_blocking(move || {
        let path = match session_file(&db, &engine, &session_id) {
            Some(path) => path,
            None => {
                super::scanner::scan_now(&db, &sink)?;
                session_file(&db, &engine, &session_id)
                    .ok_or_else(|| "CCGUI_SESSION_NOT_FOUND".to_string())?
            }
        };
        super::parse_session_file(&engine, std::path::Path::new(&path)).map(|parsed| {
            parsed
                .messages
                .into_iter()
                .map(|mut message| {
                    message.images = std::mem::take(&mut message.images)
                        .into_iter()
                        .filter_map(|image| image_data_url(&image))
                        .collect();
                    message
                })
                .collect()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads an image a past session pointed at, wherever the engine or the person kept it"
)]
fn image_data_url(image: &str) -> Option<String> {
    use base64::Engine as _;
    if image.starts_with("data:image/") {
        return Some(image.to_string());
    }
    let path = std::path::Path::new(image);
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => return None,
    };
    if std::fs::metadata(path).ok()?.len() > 8 * 1024 * 1024 {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub(crate) fn add_workspace_inner(
    db: &Arc<crate::engines::support::db::Db>,
    sink: &Arc<crate::engines::support::event_sink::EventSink>,
    path: &str,
) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".to_string());
    }
    if !is_folder(trimmed) {
        return Err(format!("not a directory: {trimmed}"));
    }
    let name = std::path::Path::new(trimmed)
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| match trimmed.trim_end_matches(['/', '\\']) {
            "" => trimmed.to_string(),
            rest => rest.to_string(),
        });
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    {
        let conn = db.0.lock();
        conn.execute(
            "INSERT INTO cli_workspaces(id, path, name, last_opened_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(path) DO UPDATE SET last_opened_at=excluded.last_opened_at",
            rusqlite::params![id, trimmed, name, now],
        )
        .map_err(|e| e.to_string())?;
    }
    super::scanner::spawn_scan(Arc::clone(db), Arc::clone(sink));
    Ok(())
}

#[allow(
    clippy::disallowed_methods,
    reason = "checks the folder the person is adding to history, which need not be linked yet"
)]
fn is_folder(path: &str) -> bool {
    std::path::Path::new(path).is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_session_requires_existing_row_and_persists_title() {
        let home = scratch_dir("rename");
        {
            let db = crate::engines::support::db::Db::open_at(&home.join("app.db")).unwrap();
            assert_eq!(
                rename_session_in(&db, "qoder", "missing", "title"),
                Err("CCGUI_SESSION_NOT_FOUND".to_string())
            );
            db.0.lock().execute(
                    "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms)
                     VALUES('qoder', 'sid', '/ws', '/ws/sid.jsonl', 1, 1)", [],
                ).unwrap();
            assert!(rename_session_in(&db, "claude", "sid", "wrong engine").is_err());
            rename_session_in(&db, "qoder", "sid", "  新标题  ").unwrap();
            rename_session_in(&db, "qoder", "sid", "新标题").unwrap();
            assert_eq!(
                list_sessions_from(&db).unwrap()[0].custom_title.as_deref(),
                Some("新标题")
            );
        }
        {
            let db = crate::engines::support::db::Db::open_at(&home.join("app.db")).unwrap();
            assert_eq!(
                list_sessions_from(&db).unwrap()[0].custom_title.as_deref(),
                Some("新标题")
            );
            rename_session_in(&db, "qoder", "sid", "   ").unwrap();
            assert_eq!(list_sessions_from(&db).unwrap()[0].custom_title, None);
        }
        std::fs::remove_dir_all(&home).unwrap();
    }

    fn scratch_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-reader-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn session_list_reads_through_writer_lock() {
        let home = scratch_dir("list-reader");
        let db = Arc::new(crate::engines::support::db::Db::open_at(&home.join("app.db")).unwrap());
        db.0.lock()
            .execute(
                "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title)
                 VALUES('claude', 'sid-1', '/ws', '/tmp/sid-1.jsonl', 1, 1, 'readable while indexing')",
                [],
            )
            .unwrap();

        let writer = db.0.lock();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker_db = Arc::clone(&db);
        let worker = std::thread::spawn(move || {
            tx.send(list_sessions_from(&worker_db)).unwrap();
        });
        let result = rx.recv_timeout(std::time::Duration::from_secs(2));
        drop(writer);
        worker.join().unwrap();

        let sessions = result
            .expect("list_sessions blocked on the writer")
            .unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "sid-1");
    }
}
