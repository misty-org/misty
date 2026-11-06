use super::*;

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
