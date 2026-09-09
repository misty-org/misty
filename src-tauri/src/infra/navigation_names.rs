use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavigationDocument {
    pub version: u32,
    #[serde(default)]
    pub accounts: BTreeMap<String, BTreeMap<String, String>>,
}
impl Default for NavigationDocument {
    fn default() -> Self {
        Self {
            version: 1,
            accounts: BTreeMap::new(),
        }
    }
}
#[derive(Clone, Serialize)]
pub struct NavigationSnapshot {
    pub names: BTreeMap<String, String>,
    pub error: Option<String>,
}
pub struct NavigationNamesService {
    path: PathBuf,
    document: Mutex<NavigationDocument>,
}
fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.chars().count() <= 120
        && !value
            .chars()
            .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
}
fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 2048 && !key.chars().any(char::is_control)
}
impl NavigationNamesService {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            document: Mutex::new(NavigationDocument::default()),
        }
    }
    async fn read(&self) -> Result<NavigationDocument, String> {
        match tokio::fs::read(&self.path).await {
            Ok(bytes) => {
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err("Navigation names file is too large.".into());
                }
                let doc: NavigationDocument = serde_json::from_slice(&bytes).map_err(|_| {
                    "Navigation names file is invalid. Correct navigation.json and retry."
                })?;
                if doc.version != 1
                    || doc.accounts.iter().any(|(account, names)| {
                        !valid_key(account)
                            || names
                                .iter()
                                .any(|(key, name)| !valid_key(key) || !valid_name(name))
                    })
                {
                    return Err(
                        "Navigation names contain an unsupported version or invalid label.".into(),
                    );
                }
                Ok(doc)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(NavigationDocument::default()),
            Err(_) => {
                Err("Misty could not read navigation.json. Check its file permissions.".into())
            }
        }
    }
    pub async fn snapshot(&self, account: &str) -> NavigationSnapshot {
        let mut current = self.document.lock().await;
        let error = match self.read().await {
            Ok(doc) => {
                *current = doc;
                None
            }
            Err(e) => Some(e),
        };
        NavigationSnapshot {
            names: current.accounts.get(account).cloned().unwrap_or_default(),
            error,
        }
    }
    pub async fn update(
        &self,
        account: String,
        key: String,
        name: Option<String>,
    ) -> Result<NavigationSnapshot, String> {
        if !valid_key(&account) || !valid_key(&key) || name.as_ref().is_some_and(|n| !valid_name(n))
        {
            return Err("Choose a single-line name of 1–120 characters.".into());
        }
        let mut current = self.document.lock().await;
        // Merge into the latest file, never overwrite malformed external edits.
        let mut next = self.read().await?;
        let names = next.accounts.entry(account.clone()).or_default();
        if let Some(name) = name {
            names.insert(key, name);
        } else {
            names.remove(&key);
        }
        let parent = self
            .path
            .parent()
            .ok_or("Navigation config directory is missing")?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
        let temporary = parent.join(format!(".navigation-{}.tmp", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        let result = async {
            use tokio::io::AsyncWriteExt;
            let mut options = tokio::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temporary).await.map_err(|e| e.to_string())?;
            file.write_all(&bytes).await.map_err(|e| e.to_string())?;
            file.sync_all().await.map_err(|e| e.to_string())?;
            tokio::fs::rename(&temporary, &self.path)
                .await
                .map_err(|e| e.to_string())
        }
        .await;
        if let Err(e) = result {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(e);
        }
        *current = next;
        Ok(NavigationSnapshot {
            names: current.accounts.get(&account).cloned().unwrap_or_default(),
            error: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn names_merge_reset_and_recover_from_external_edits() {
        let root = std::env::temp_dir().join(format!("misty-names-{}", uuid::Uuid::new_v4()));
        let path = root.join("navigation.json");
        let service = NavigationNamesService::new(path.clone());
        let (a, b) = tokio::join!(
            service.update("account-a".into(), "tab:1".into(), Some("School".into())),
            service.update("account-a".into(), "tab:2".into(), Some("Mail".into()))
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(service.snapshot("account-a").await.names.len(), 2);
        assert_eq!(
            NavigationNamesService::new(path.clone())
                .snapshot("account-a")
                .await
                .names["tab:1"],
            "School"
        );
        assert!(service.snapshot("account-b").await.names.is_empty());
        tokio::fs::write(&path, b"invalid").await.unwrap();
        let snapshot = service.snapshot("account-a").await;
        assert!(snapshot.error.is_some());
        assert_eq!(snapshot.names.len(), 2);
        assert!(service
            .update("account-a".into(), "tab:1".into(), None)
            .await
            .is_err());
        tokio::fs::write(
            &path,
            br#"{"version":1,"accounts":{"account-a":{"tab:1":"Edited"}}}"#,
        )
        .await
        .unwrap();
        assert_eq!(service.snapshot("account-a").await.names["tab:1"], "Edited");
        service
            .update("account-a".into(), "tab:1".into(), None)
            .await
            .unwrap();
        assert!(NavigationNamesService::new(path)
            .snapshot("account-a")
            .await
            .names
            .is_empty());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn write_failure_does_not_replace_saved_names() {
        let root = std::env::temp_dir().join(format!("misty-names-{}", uuid::Uuid::new_v4()));
        let path = root.join("navigation.json");
        let service = NavigationNamesService::new(path.clone());
        service
            .update("account".into(), "tab:1".into(), Some("Saved".into()))
            .await
            .unwrap();
        let original = tokio::fs::read(&path).await.unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o500))
                .await
                .unwrap();
            let result = service
                .update("account".into(), "tab:1".into(), Some("Unsaved".into()))
                .await;
            tokio::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                .await
                .unwrap();
            assert!(result.is_err());
            assert_eq!(tokio::fs::read(&path).await.unwrap(), original);
            assert_eq!(service.snapshot("account").await.names["tab:1"], "Saved");
        }
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
    #[test]
    fn labels_are_bounded_single_line() {
        for value in ["", " padded ", "a\nb", "a\u{2028}b"] {
            assert!(!valid_name(value));
        }
        assert!(valid_name("家族"));
        assert!(!valid_name(&"a".repeat(121)));
    }
}
