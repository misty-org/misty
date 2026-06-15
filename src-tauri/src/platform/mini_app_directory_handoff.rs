//! Single-use, live-view handoffs. Tickets confer no authority outside the same
//! installation/account/Space and never expose or reopen an ambient native path.
use super::super::Instance;
use super::{file_jobs::FolderGrant, PermissionSet};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc},
    time::{Duration, Instant},
};

pub struct DirectoryShare {
    directory: String,
    writable: bool,
    epoch: u64,
    expires: Instant,
}
const TTL: Duration = Duration::from_secs(60);
const LIMIT: usize = 8;

fn string<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty() && v.len() <= 256)
        .ok_or_else(|| "Missing directory handoff identifier.".into())
}
fn write(params: &Value) -> Result<bool, String> {
    match params.get("write") {
        None | Some(Value::Bool(false)) => Ok(false),
        Some(Value::Bool(true)) => Ok(true),
        _ => Err("Invalid directory handoff access.".into()),
    }
}
fn authorize(permissions: &PermissionSet, writable: bool) -> Result<(), String> {
    if permissions.owner_namespace.is_none() {
        return Err("Folder handoffs require an identified Host account and Space.".into());
    }
    permissions.authorize(if writable {
        "files.write"
    } else {
        "files.read"
    })?;
    Ok(())
}

pub fn execute(
    registry: &mut HashMap<String, Instance>,
    instance: &str,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    let permissions = &mut registry
        .get_mut(instance)
        .ok_or("App is closed.")?
        .permissions;
    if method == "files.cancelDirectoryShare" {
        permissions
            .directory_shares
            .remove(string(params, "ticket")?);
        return Ok(Value::Null);
    }
    let writable = write(params)?;
    authorize(permissions, writable)?;
    if method == "files.shareDirectory" {
        let handle = string(params, "directory")?;
        let folder = permissions
            .folders
            .get(handle)
            .ok_or("This folder is not granted to this App.")?;
        if writable && !folder.writable {
            return Err("This folder was granted read-only.".into());
        }
        permissions.directory_shares.retain(|_, share| {
            share.expires > Instant::now() && permissions.folders.contains_key(&share.directory)
        });
        if permissions.directory_shares.len() >= LIMIT {
            return Err("Cancel an old folder handoff before creating another.".into());
        }
        let ticket = uuid::Uuid::new_v4().to_string();
        permissions.directory_shares.insert(
            ticket.clone(),
            DirectoryShare {
                directory: handle.into(),
                writable,
                epoch: permissions.epoch,
                expires: Instant::now() + TTL,
            },
        );
        return Ok(json!({"ticket":ticket,"expiresInMs":60000}));
    }
    if method != "files.adoptDirectory" {
        return Err("Unknown directory handoff method.".into());
    }
    if permissions.folders.len() >= 32 {
        return Err("Release an open folder before opening another.".into());
    }
    let ticket = string(params, "ticket")?;
    let owner = permissions.owner_namespace.clone();
    let app_id = permissions.app_id.clone();
    let (source, directory, name) = registry
        .iter()
        .filter(|(id, source)| {
            *id != instance
                && source.permissions.owner_namespace == owner
                && source.permissions.app_id == app_id
        })
        .find_map(|(id, source)| {
            source
                .permissions
                .directory_shares
                .get(ticket)
                .map(|share| (id, &source.permissions, share))
        })
        .ok_or_else(|| "The folder handoff is unavailable or expired.".to_owned())
        .and_then(|(id, source, share)| {
            authorize(source, writable)?;
            if share.expires <= Instant::now()
                || share.epoch != source.epoch
                || (writable && !share.writable)
            {
                return Err("The folder handoff is unavailable or expired.".into());
            }
            let folder = source
                .folders
                .get(&share.directory)
                .ok_or("The shared folder was released.")?;
            if writable && !folder.writable {
                return Err("This folder was granted read-only.".into());
            }
            Ok((id.clone(), folder.directory.clone(), folder.name.clone()))
        })?;
    let handle = uuid::Uuid::new_v4().to_string();
    registry
        .get_mut(instance)
        .unwrap()
        .permissions
        .folders
        .insert(
            handle.clone(),
            FolderGrant {
                directory,
                name: name.clone(),
                writable,
                released: Arc::new(AtomicBool::new(false)),
            },
        );
    // All validation and consumption occur under the registry lock: a ticket can
    // produce exactly one new grant, even when multiple views race to adopt it.
    registry
        .get_mut(&source)
        .unwrap()
        .permissions
        .directory_shares
        .remove(ticket);
    Ok(json!({"handle":handle,"name":name,"writable":writable}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cap_std::{ambient_authority, fs::Dir};
    fn fixture() -> (tempfile::TempDir, HashMap<String, Instance>) {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("project")).unwrap();
        std::fs::write(root.path().join("project/日本語.txt"), "original").unwrap();
        let mut registry = HashMap::new();
        for id in ["first", "second", "third"] {
            let mut permissions = PermissionSet::from_document(
                "code",
                &json!({"runtime_capabilities":["files.read","files.write"]}),
                None,
            )
            .unwrap();
            permissions.owner_namespace = Some("installed-app-account-space".into());
            permissions.decide("files.read", true).unwrap();
            permissions.decide("files.write", true).unwrap();
            registry.insert(
                id.into(),
                Instance {
                    root: root.path().into(),
                    permissions,
                    _profile: None,
                    pending: HashMap::new(),
                },
            );
        }
        registry
            .get_mut("first")
            .unwrap()
            .permissions
            .folders
            .insert(
                "folder".into(),
                FolderGrant {
                    directory: Arc::new(
                        Dir::open_ambient_dir(root.path().join("project"), ambient_authority())
                            .unwrap(),
                    ),
                    name: "Project".into(),
                    writable: true,
                    released: Arc::new(AtomicBool::new(false)),
                },
            );
        (root, registry)
    }
    fn share(registry: &mut HashMap<String, Instance>, writable: bool) -> Value {
        execute(
            registry,
            "first",
            "files.shareDirectory",
            &json!({"directory":"folder","write":writable}),
        )
        .unwrap()
    }
    fn adopt(
        registry: &mut HashMap<String, Instance>,
        ticket: &Value,
        writable: bool,
    ) -> Result<Value, String> {
        execute(
            registry,
            "second",
            "files.adoptDirectory",
            &json!({"ticket":ticket["ticket"],"write":writable}),
        )
    }
    #[test]
    fn independent_descriptor_survives_source_close_and_path_replacement() {
        let (root, mut registry) = fixture();
        let ticket = share(&mut registry, true);
        // Rename the chosen directory and replace its old path: adoption must
        // retain the chosen inode, not reopen the new folder at that path.
        std::fs::rename(root.path().join("project"), root.path().join("moved")).unwrap();
        std::fs::create_dir(root.path().join("project")).unwrap();
        std::fs::write(root.path().join("project/日本語.txt"), "replacement").unwrap();
        let receipt = adopt(&mut registry, &ticket, true).unwrap();
        assert!(adopt(&mut registry, &ticket, true).is_err());
        registry.remove("first");
        let folder = &registry["second"].permissions.folders[receipt["handle"].as_str().unwrap()];
        assert!(!folder.released.load(std::sync::atomic::Ordering::Acquire));
        assert_eq!(
            folder.directory.read_to_string("日本語.txt").unwrap(),
            "original"
        );
        folder.directory.write("new.txt", "new").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("moved/new.txt")).unwrap(),
            "new"
        );
        assert!(!root.path().join("project/new.txt").exists());
    }
    #[test]
    fn rejects_foreign_owner_app_and_unidentified_views_without_consuming_ticket() {
        let (_root, mut registry) = fixture();
        let ticket = share(&mut registry, false);
        for owner in [
            Some("other-account"),
            Some("other-space"),
            Some("other-installation"),
            None,
        ] {
            registry
                .get_mut("second")
                .unwrap()
                .permissions
                .owner_namespace = owner.map(str::to_owned);
            assert!(adopt(&mut registry, &ticket, false).is_err());
        }
        registry
            .get_mut("second")
            .unwrap()
            .permissions
            .owner_namespace = Some("installed-app-account-space".into());
        registry.get_mut("second").unwrap().permissions.app_id = "other-app".into();
        assert!(adopt(&mut registry, &ticket, false).is_err());
        registry.get_mut("second").unwrap().permissions.app_id = "code".into();
        assert!(adopt(&mut registry, &ticket, false).is_ok());
    }
    #[test]
    fn cannot_elevate_readonly_handoffs_or_missing_receiver_permission() {
        let (_root, mut registry) = fixture();
        let ticket = share(&mut registry, false);
        assert!(adopt(&mut registry, &ticket, true).is_err());
        registry
            .get_mut("second")
            .unwrap()
            .permissions
            .decide("files.read", false)
            .unwrap();
        assert!(adopt(&mut registry, &ticket, false).is_err());
        registry
            .get_mut("second")
            .unwrap()
            .permissions
            .decide("files.read", true)
            .unwrap();
        let receipt = adopt(&mut registry, &ticket, false).unwrap();
        assert_eq!(receipt["writable"], false);
        assert!(
            !registry["second"].permissions.folders[receipt["handle"].as_str().unwrap()].writable
        );
        registry
            .get_mut("first")
            .unwrap()
            .permissions
            .folders
            .get_mut("folder")
            .unwrap()
            .writable = false;
        assert!(execute(
            &mut registry,
            "first",
            "files.shareDirectory",
            &json!({"directory":"folder","write":true})
        )
        .is_err());
    }
    #[test]
    fn source_release_close_revoke_expiry_and_cancel_invalidate_unconsumed_tickets() {
        for reason in ["release", "close", "revoke", "expire", "cancel"] {
            let (_root, mut registry) = fixture();
            let ticket = share(&mut registry, true);
            match reason {
                "release" => {
                    registry
                        .get_mut("first")
                        .unwrap()
                        .permissions
                        .folders
                        .remove("folder");
                }
                "close" => {
                    registry.remove("first");
                }
                "revoke" => {
                    registry
                        .get_mut("first")
                        .unwrap()
                        .permissions
                        .decide("files.write", false)
                        .unwrap();
                }
                "expire" => {
                    registry
                        .get_mut("first")
                        .unwrap()
                        .permissions
                        .directory_shares
                        .get_mut(ticket["ticket"].as_str().unwrap())
                        .unwrap()
                        .expires = Instant::now() - Duration::from_secs(1);
                }
                "cancel" => {
                    execute(
                        &mut registry,
                        "first",
                        "files.cancelDirectoryShare",
                        &json!({"ticket":ticket["ticket"]}),
                    )
                    .unwrap();
                }
                _ => unreachable!(),
            }
            assert!(adopt(&mut registry, &ticket, true).is_err(), "{reason}");
            assert!(registry["second"].permissions.folders.is_empty());
        }
    }
    #[test]
    fn bounds_tickets_and_failed_capacity_checks_do_not_consume_them() {
        let (_root, mut registry) = fixture();
        let ticket = share(&mut registry, false);
        for _ in 1..LIMIT {
            share(&mut registry, false);
        }
        assert!(execute(
            &mut registry,
            "first",
            "files.shareDirectory",
            &json!({"directory":"folder"})
        )
        .is_err());
        let directory = registry["first"].permissions.folders["folder"]
            .directory
            .clone();
        for n in 0..32 {
            registry
                .get_mut("second")
                .unwrap()
                .permissions
                .folders
                .insert(
                    n.to_string(),
                    FolderGrant {
                        directory: directory.clone(),
                        name: "copy".into(),
                        writable: false,
                        released: Arc::new(AtomicBool::new(false)),
                    },
                );
        }
        assert!(adopt(&mut registry, &ticket, false).is_err());
        registry
            .get_mut("second")
            .unwrap()
            .permissions
            .folders
            .remove("0");
        assert!(adopt(&mut registry, &ticket, false).is_ok());
        // Cancelling another view's token cannot revoke its outstanding handoff.
        let next = share(&mut registry, false);
        execute(
            &mut registry,
            "third",
            "files.cancelDirectoryShare",
            &json!({"ticket":next["ticket"]}),
        )
        .unwrap();
        assert!(registry["first"]
            .permissions
            .directory_shares
            .contains_key(next["ticket"].as_str().unwrap()));
    }
}
