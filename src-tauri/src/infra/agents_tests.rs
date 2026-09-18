use super::*;

#[test]
fn stored_windows_paths_lose_the_verbatim_prefix() {
    let mut connection = Connection::open_in_memory().unwrap();
    crate::infra::store::migrate(&mut connection).unwrap();
    for (id, path) in [
        ("a", r"\\?\C:\Users\me\Site"),
        ("b", r"\\?\UNC\server\share\Site"),
        ("c", r"D:\Plain"),
    ] {
        connection
            .execute(
                "INSERT INTO local_agent_scopes (id,device_id,display_name,local_path,created_at) VALUES (?1,'d',?1,?2,'t')",
                [id, path],
            )
            .unwrap();
    }
    strip_verbatim_prefixes(&connection).unwrap();
    let path = |id: &str| -> String {
        connection
            .query_row(
                "SELECT local_path FROM local_agent_scopes WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .unwrap()
    };
    assert_eq!(path("a"), r"C:\Users\me\Site");
    assert_eq!(path("b"), r"\\server\share\Site");
    assert_eq!(path("c"), r"D:\Plain");
}

#[test]
fn shared_folders_and_the_device_id_import_once_from_an_earlier_database() {
    let directory = tempfile::tempdir().unwrap();
    let legacy = directory.path().join("data.db");
    {
        let old = Connection::open(&legacy).unwrap();
        // An older build: no project columns.
        old.execute_batch(
            "CREATE TABLE local_agent_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE local_agent_scopes (id TEXT PRIMARY KEY, device_id TEXT NOT NULL,
                 display_name TEXT NOT NULL, local_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
             INSERT INTO local_agent_settings VALUES ('device_id','device_old');
             INSERT INTO local_agent_scopes VALUES ('s1','device_old','Docs','/tmp/docs','t');",
        )
        .unwrap();
    }
    let store = Store::at(directory.path().join("misty.db"));
    import_legacy(&store, &legacy).unwrap();
    let connection = store.connect().unwrap();
    assert_eq!(device_id(&connection).unwrap(), "device_old");
    let (access, installs): (String, i64) = connection
        .query_row(
            "SELECT access, allow_installs FROM local_agent_scopes WHERE id='s1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((access.as_str(), installs), ("read", 0));
    // A folder removed afterwards does not come back.
    connection.execute("DELETE FROM local_agent_scopes", []).unwrap();
    drop(connection);
    import_legacy(&store, &legacy).unwrap();
    let remaining: i64 = store
        .connect()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM local_agent_scopes", [], |row| row.get(0))
        .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn folder_scopes_list_only_inside_the_chosen_folder() {
    let state = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    fs::create_dir(folder.path().join("Reports")).unwrap();
    fs::write(folder.path().join("Reports/q3.txt"), "Revenue grew").unwrap();
    fs::write(folder.path().join("notes.md"), "Plan").unwrap();
    fs::write(folder.path().join(".secret"), "hidden").unwrap();
    let service = AgentService {
        database_path: state.path().join("misty.db"),
    };
    let scope = service
        .register_folder_scope(folder.path().to_path_buf())
        .await
        .unwrap();
    let again = service
        .register_folder_scope(folder.path().to_path_buf())
        .await
        .unwrap();
    assert_eq!(scope["id"], again["id"], "a folder is granted once");
    let id = scope["id"].as_str().unwrap().to_owned();
    let root = service
        .list_scoped_files(ListScopedFilesRequest {
            scope_id: id.clone(),
            relative_path: String::new(),
        })
        .await
        .unwrap();
    let names: Vec<_> = root["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["relativePath"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, vec!["Reports", "notes.md"]);
    let nested = service
        .list_scoped_files(ListScopedFilesRequest {
            scope_id: id.clone(),
            relative_path: "Reports".into(),
        })
        .await
        .unwrap();
    assert_eq!(nested["entries"][0]["relativePath"], "Reports/q3.txt");
    for outside in ["..", "../..", "/etc"] {
        assert!(service
            .list_scoped_files(ListScopedFilesRequest {
                scope_id: id.clone(),
                relative_path: outside.into(),
            })
            .await
            .is_err());
    }
    let document = service
        .scoped_document_path(PrepareScopedAgentDocumentRequest {
            scope_id: id,
            relative_path: "Reports/q3.txt".into(),
        })
        .await
        .unwrap();
    assert!(document.ends_with("Reports/q3.txt"));
}
