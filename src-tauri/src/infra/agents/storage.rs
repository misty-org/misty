//! The agents database rows behind the service: the device id, shared folders
//! and the import from an earlier layout.
use super::*;

/// Windows folders were stored with the `\\?\` prefix canonicalizing adds; they are stored
/// without it now (see `canonical`).
pub(super) fn strip_verbatim_prefixes(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        r"UPDATE OR IGNORE local_agent_scopes SET local_path = '\\' || substr(local_path, 9)
              WHERE local_path LIKE '\\?\UNC\%';
          UPDATE OR IGNORE local_agent_scopes SET local_path = substr(local_path, 5)
              WHERE local_path LIKE '\\?\%';",
    )
}

/// Imports the shared folders and the device id from `db/data.db` of an earlier layout,
/// once.
pub(super) fn import_legacy(store: &Store, legacy: &Path) -> rusqlite::Result<()> {
    store.import_once("agents/data.db", |connection| {
        if !legacy.is_file() {
            return Ok(());
        }
        let old = Connection::open_with_flags(legacy, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        // A column an older build never added falls back to the new table's default.
        let columns: Vec<String> = old
            .prepare("PRAGMA table_info(local_agent_scopes)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<_, _>>()?;
        if let Ok(mut statement) = old.prepare("SELECT key,value FROM local_agent_settings") {
            for row in statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))? {
                let (key, value) = row?;
                connection.execute(
                    "INSERT OR IGNORE INTO local_agent_settings(key,value) VALUES(?1,?2)",
                    [key, value],
                )?;
            }
        }
        let has = |name: &str| columns.iter().any(|column| column == name);
        let select = format!(
            "SELECT id,device_id,display_name,local_path,created_at,{},{},{},{} FROM local_agent_scopes",
            if has("access") { "access" } else { "'read'" },
            if has("allow_installs") { "allow_installs" } else { "0" },
            if has("allow_push") { "allow_push" } else { "0" },
            if has("allow_push_default") { "allow_push_default" } else { "0" },
        );
        if let Ok(mut statement) = old.prepare(&select) {
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            })?;
            for row in rows {
                let row = row?;
                connection.execute(
                    "INSERT OR IGNORE INTO local_agent_scopes
                     (id,device_id,display_name,local_path,created_at,access,allow_installs,allow_push,allow_push_default)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    rusqlite::params![row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8],
                )?;
            }
        }
        strip_verbatim_prefixes(connection)
    })
}

pub(super) fn device_snapshot_sync(connection: &mut Connection) -> rusqlite::Result<Value> {
    let device_id = device_id(connection)?;
    let scopes = {
        let mut statement = connection.prepare(
            "SELECT id,device_id,display_name,access,allow_installs,allow_push,allow_push_default,local_path FROM local_agent_scopes ORDER BY created_at",
        )?;
        let rows = statement
            .query_map([], |row| {
                let project = row.get::<_, String>(3)? == "write";
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "deviceId": row.get::<_, String>(1)?,
                    "displayName": row.get::<_, String>(2)?,
                    "kind": if project { "project_folder" } else { "local_folder" },
                    "allowInstalls": project && row.get::<_, i64>(4)? != 0,
                    "allowPush": project && row.get::<_, i64>(5)? != 0,
                    "allowPushDefault": project && row.get::<_, i64>(6)? != 0,
                    "git": project && Path::new(&row.get::<_, String>(7)?).join(".git").is_dir(),
                    "relativePath": Value::Null,
                    "available": true,
                }))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    Ok(json!({
        "version": 2,
        "device": {
            "id": device_id,
            "displayName": "This Misty",
            "status": "online",
            "capabilities": ["workflow_node_leases", "read_content", "document_intelligence", "citations"],
            "lastSeenAt": Utc::now().to_rfc3339(),
        },
        "scopes": scopes,
        "loadedAt": Utc::now().to_rfc3339(),
    }))
}

pub(super) fn scoped_file_path_sync(
    connection: &mut Connection,
    scope_id: &str,
    relative: &str,
) -> rusqlite::Result<PathBuf> {
    let root: String = connection.query_row(
        "SELECT local_path FROM local_agent_scopes WHERE id=?1",
        [scope_id],
        |row| row.get(0),
    )?;
    let relative_path = Path::new(relative);
    if relative.trim().is_empty()
        || relative_path.is_absolute()
        || relative_path.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(validation_error(
            "Document path is outside its device scope.",
        ));
    }
    let root = canonical(root).map_err(io_error)?;
    let target = canonical(root.join(relative_path)).map_err(io_error)?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err(validation_error(
            "Document path is outside its device scope.",
        ));
    }
    Ok(target)
}

pub(crate) fn device_id(connection: &Connection) -> rusqlite::Result<String> {
    if let Some(value) = connection
        .query_row(
            "SELECT value FROM local_agent_settings WHERE key='device_id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(value);
    }
    let value = format!("device_{}", Uuid::new_v4().simple());
    connection.execute(
        "INSERT INTO local_agent_settings(key,value) VALUES('device_id',?1)",
        [&value],
    )?;
    Ok(value)
}
