//! The real OS wall, on real files in temporary folders. If one of these fails, the permission
//! isn't holding, so they run against `sandbox-exec` itself rather than a mock.
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

use super::*;

struct Scene {
    _temp: tempfile::TempDir,
    misty: PathBuf,
    folder: PathBuf,
    outside: PathBuf,
}

fn scene() -> Scene {
    let temp = tempfile::tempdir().unwrap();
    let base = temp.path().canonicalize().unwrap();
    let (misty, folder, outside) = (
        base.join("misty"),
        base.join("shared"),
        base.join("outside"),
    );
    fs::create_dir_all(&misty).unwrap();
    fs::create_dir_all(folder.join("sub")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::write(misty.join("vault.db"), "secret").unwrap();
    fs::write(folder.join("a.txt"), "keep").unwrap();
    fs::write(folder.join("sub/b.txt"), "keep").unwrap();
    fs::write(folder.join(".env"), "TOKEN=1").unwrap();
    fs::write(folder.join("agents.env"), "TOKEN=1").unwrap();
    fs::write(outside.join("o.txt"), "keep").unwrap();
    Scene {
        _temp: temp,
        misty,
        folder,
        outside,
    }
}

async fn shell(
    scene: &Scene,
    key: &str,
    command: &str,
    folder: Option<(&Path, bool)>,
) -> ShellOutcome {
    run(
        &scene.misty,
        ShellRequest {
            workspace_key: key.into(),
            command: command.into(),
            timeout: Some(Duration::from_secs(20)),
            folder: folder.map(|(root, writable)| SharedFolder {
                root: root.to_path_buf(),
                writable,
            }),
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn the_workspace_is_free_to_use_and_private() {
    let scene = scene();
    let wrote = shell(
        &scene,
        "chat-a",
        "mkdir -p d/e && echo hi > d/e/f && cat d/e/f && rm -rf d && echo gone",
        None,
    )
    .await;
    assert_eq!(wrote.exit_code, Some(0), "{}", wrote.stderr);
    assert_eq!(wrote.stdout, "hi\ngone\n");
    let kept = shell(&scene, "chat-a", "echo saved > note.txt", None).await;
    assert_eq!(kept.exit_code, Some(0));
    let same = shell(&scene, "chat-a", "cat note.txt", None).await;
    assert_eq!(same.stdout, "saved\n");
    let other = shell(&scene, "chat-b", "cat note.txt", None).await;
    assert_ne!(other.exit_code, Some(0), "another chat can't see it");
    let reach = shell(
        &scene,
        "chat-b",
        &format!("ls {}/agent-workspaces", scene.misty.display()),
        None,
    )
    .await;
    assert_ne!(reach.exit_code, Some(0), "or list the others");
}

#[tokio::test]
async fn nothing_outside_can_be_read_changed_or_deleted() {
    let scene = scene();
    let outside = scene.outside.display();
    let misty = scene.misty.display();
    for command in [
        format!("cat {outside}/o.txt"),
        format!("rm -rf {outside}"),
        format!("echo x > {outside}/new.txt"),
        format!("mv {outside}/o.txt moved.txt"),
        format!("cat {misty}/vault.db"),
        format!("rm {misty}/vault.db"),
        format!("ls {}", dirs::home_dir().unwrap().display()),
    ] {
        let outcome = shell(&scene, "chat", &command, None).await;
        assert_ne!(
            outcome.exit_code,
            Some(0),
            "{command} should be refused: {}",
            outcome.stdout
        );
    }
    assert!(scene.outside.join("o.txt").exists());
    assert!(scene.misty.join("vault.db").exists());
    assert!(!scene.outside.join("new.txt").exists());
}

#[tokio::test]
async fn a_folder_without_write_access_is_read_only() {
    let scene = scene();
    let folder = Some((scene.folder.as_path(), false));
    let read = shell(&scene, "chat", "cat shared-folder/a.txt", folder).await;
    assert_eq!(read.stdout, "keep");
    assert_eq!(read.shared_folder, Some("shared-folder"));
    for command in [
        "echo x > shared-folder/new.txt",
        "echo x >> shared-folder/a.txt",
        "rm shared-folder/a.txt",
    ] {
        let outcome = shell(&scene, "chat", command, folder).await;
        assert_ne!(outcome.exit_code, Some(0), "{command}");
    }
    assert_eq!(
        fs::read_to_string(scene.folder.join("a.txt")).unwrap(),
        "keep"
    );
}

#[tokio::test]
async fn write_access_adds_and_edits_but_never_deletes() {
    let scene = scene();
    let folder = Some((scene.folder.as_path(), true));
    let added = shell(&scene, "chat", "echo new > shared-folder/new.txt && mkdir shared-folder/made && echo more >> shared-folder/a.txt", folder).await;
    assert_eq!(added.exit_code, Some(0), "{}", added.stderr);
    assert_eq!(
        fs::read_to_string(scene.folder.join("a.txt")).unwrap(),
        "keepmore\n"
    );
    for command in [
        "rm shared-folder/new.txt",
        "rm -rf shared-folder/sub",
        "find shared-folder/ -name new.txt -exec rm {} +",
        "rmdir shared-folder/made",
        "mv shared-folder/new.txt shared-folder/renamed.txt",
        "mv shared-folder/new.txt moved-out.txt",
    ] {
        let outcome = shell(&scene, "chat", command, folder).await;
        assert_ne!(outcome.exit_code, Some(0), "{command} should be refused");
    }
    // Only the file surviving proves this one, whatever a tool's exit code says.
    shell(
        &scene,
        "chat",
        "find shared-folder/ -name new.txt -delete",
        folder,
    )
    .await;
    assert!(scene.folder.join("new.txt").exists());
    assert!(scene.folder.join("made").exists());
    assert!(scene.folder.join("sub/b.txt").exists());
    assert!(!scene.folder.join("renamed.txt").exists());
}

#[tokio::test]
async fn secret_files_stay_closed_even_in_a_shared_folder() {
    let scene = scene();
    let folder = Some((scene.folder.as_path(), true));
    for command in [
        "cat shared-folder/.env",
        "echo x > shared-folder/.env",
        "cat shared-folder/agents.env",
    ] {
        let outcome = shell(&scene, "chat", command, folder).await;
        assert_ne!(outcome.exit_code, Some(0), "{command}");
    }
    assert_eq!(
        fs::read_to_string(scene.folder.join(".env")).unwrap(),
        "TOKEN=1"
    );
    fs::create_dir_all(scene.folder.join("repo/.git/hooks")).unwrap();
    let hook = shell(
        &scene,
        "chat",
        "echo evil > shared-folder/repo/.git/hooks/pre-commit",
        folder,
    )
    .await;
    assert_ne!(
        hook.exit_code,
        Some(0),
        "a hook would run outside the sandbox later"
    );
}

#[tokio::test]
async fn relinking_the_folder_reaches_nothing_more() {
    let scene = scene();
    let target = scene.outside.join("o.txt");
    let outcome = shell(
        &scene,
        "chat",
        &format!("ln -s {} link && cat link", target.display()),
        None,
    )
    .await;
    assert_ne!(
        outcome.exit_code,
        Some(0),
        "a link is judged by its real path"
    );
}

mod processes;
mod wall;
