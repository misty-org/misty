//! The agents database rows behind the service: the device id and shared folders.
use crate::agents::*;

pub(in crate::agents) fn device_snapshot_sync(
    connection: &mut Connection,
) -> rusqlite::Result<Value> {
    let device_id = device_id(connection)?;
    let scopes = {
        let mut statement = connection.prepare(
            "SELECT id,device_id,display_name FROM local_agent_scopes ORDER BY created_at",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "deviceId": row.get::<_, String>(1)?,
                    "displayName": row.get::<_, String>(2)?,
                    "kind": "local_folder",
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
            "capabilities": ["workflow_node_leases", "document_intelligence", "citations"],
            "lastSeenAt": Utc::now().to_rfc3339(),
        },
        "scopes": scopes,
        "loadedAt": Utc::now().to_rfc3339(),
    }))
}

pub(in crate::agents) fn scoped_file_path_sync(
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
        || file_access::secrets::closed_to_agents(relative_path)
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
    // Asked again of where it really is, in case a link inside the folder pointed at a secret.
    let closed = target
        .strip_prefix(&root)
        .is_ok_and(file_access::secrets::closed_to_agents);
    if closed || !target.starts_with(&root) || !file_access::fs::is_file(&target) {
        return Err(validation_error(
            "Document path is outside its device scope.",
        ));
    }
    Ok(target)
}

pub(crate) fn device_id(connection: &Connection) -> rusqlite::Result<String> {
    if let Some(value) = connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope='device:id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|document| serde_json::from_str::<String>(&document).ok())
    {
        return Ok(value);
    }
    let value = format!("device_{}", Uuid::new_v4().simple());
    connection.execute(
        "INSERT OR REPLACE INTO settings_state(scope,revision,document) VALUES('device:id',1,?1)",
        [Value::String(value.clone()).to_string()],
    )?;
    Ok(value)
}
