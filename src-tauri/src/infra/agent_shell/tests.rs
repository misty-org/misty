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
    let (misty, folder, outside) = (base.join("misty"), base.join("shared"), base.join("outside"));
    fs::create_dir_all(&misty).unwrap();
    fs::create_dir_all(folder.join("sub")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::write(misty.join("vault.db"), "secret").unwrap();
    fs::write(folder.join("a.txt"), "keep").unwrap();
    fs::write(folder.join("sub/b.txt"), "keep").unwrap();
    fs::write(folder.join(".env"), "TOKEN=1").unwrap();
    fs::write(outside.join("o.txt"), "keep").unwrap();
    Scene { _temp: temp, misty, folder, outside }
}

async fn shell(scene: &Scene, key: &str, command: &str, folder: Option<(&Path, bool)>) -> ShellOutcome {
    run(
        &scene.misty,
        ShellRequest {
            workspace_key: key.into(),
            command: command.into(),
            timeout: Some(Duration::from_secs(20)),
            folder: folder.map(|(root, writable)| SharedFolder { root: root.to_path_buf(), writable }),
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn the_workspace_is_free_to_use_and_private() {
    let scene = scene();
    let wrote = shell(&scene, "chat-a", "mkdir -p d/e && echo hi > d/e/f && cat d/e/f && rm -rf d && echo gone", None).await;
    assert_eq!(wrote.exit_code, Some(0), "{}", wrote.stderr);
    assert_eq!(wrote.stdout, "hi\ngone\n");
    let kept = shell(&scene, "chat-a", "echo saved > note.txt", None).await;
    assert_eq!(kept.exit_code, Some(0));
    let same = shell(&scene, "chat-a", "cat note.txt", None).await;
    assert_eq!(same.stdout, "saved\n");
    let other = shell(&scene, "chat-b", "cat note.txt", None).await;
    assert_ne!(other.exit_code, Some(0), "another chat can't see it");
    let reach = shell(&scene, "chat-b", &format!("ls {}/agent-workspaces", scene.misty.display()), None).await;
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
        assert_ne!(outcome.exit_code, Some(0), "{command} should be refused: {}", outcome.stdout);
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
    for command in ["echo x > shared-folder/new.txt", "echo x >> shared-folder/a.txt", "rm shared-folder/a.txt"] {
        let outcome = shell(&scene, "chat", command, folder).await;
        assert_ne!(outcome.exit_code, Some(0), "{command}");
    }
    assert_eq!(fs::read_to_string(scene.folder.join("a.txt")).unwrap(), "keep");
}

#[tokio::test]
async fn write_access_adds_and_edits_but_never_deletes() {
    let scene = scene();
    let folder = Some((scene.folder.as_path(), true));
    let added = shell(&scene, "chat", "echo new > shared-folder/new.txt && mkdir shared-folder/made && echo more >> shared-folder/a.txt", folder).await;
    assert_eq!(added.exit_code, Some(0), "{}", added.stderr);
    assert_eq!(fs::read_to_string(scene.folder.join("a.txt")).unwrap(), "keepmore\n");
    for command in [
        "rm shared-folder/new.txt",
        "rm -rf shared-folder/sub",
        "find shared-folder/ -name new.txt -exec rm {} +",
        "rmdir shared-folder/made",
        "mv shared-folder/new.txt shared-folder/renamed.txt",
        "mv shared-folder/new.txt moved-out.txt",
        "perl -e 'unlink(\"shared-folder/new.txt\") or die $!'",
    ] {
        let outcome = shell(&scene, "chat", command, folder).await;
        assert_ne!(outcome.exit_code, Some(0), "{command} should be refused");
    }
    // macOS's find reports the refusal but still exits 0, so only the file surviving proves it.
    let tried = shell(&scene, "chat", "find shared-folder/ -name new.txt -delete", folder).await;
    assert!(tried.stderr.contains("not permitted"), "{}", tried.stderr);
    assert!(scene.folder.join("new.txt").exists());
    assert!(scene.folder.join("made").exists());
    assert!(scene.folder.join("sub/b.txt").exists());
    assert!(!scene.folder.join("renamed.txt").exists());
}

#[tokio::test]
async fn secret_files_stay_closed_even_in_a_shared_folder() {
    let scene = scene();
    let folder = Some((scene.folder.as_path(), true));
    for command in ["cat shared-folder/.env", "echo x > shared-folder/.env"] {
        let outcome = shell(&scene, "chat", command, folder).await;
        assert_ne!(outcome.exit_code, Some(0), "{command}");
    }
    assert_eq!(fs::read_to_string(scene.folder.join(".env")).unwrap(), "TOKEN=1");
    fs::create_dir_all(scene.folder.join("repo/.git/hooks")).unwrap();
    let hook = shell(&scene, "chat", "echo evil > shared-folder/repo/.git/hooks/pre-commit", folder).await;
    assert_ne!(hook.exit_code, Some(0), "a hook would run outside the sandbox later");
}

#[tokio::test]
async fn relinking_the_folder_reaches_nothing_more() {
    let scene = scene();
    let target = scene.outside.join("o.txt");
    let outcome = shell(&scene, "chat", &format!("ln -s {} link && cat link", target.display()), None).await;
    assert_ne!(outcome.exit_code, Some(0), "a link is judged by its real path");
}

#[tokio::test]
async fn commands_have_no_network_and_a_clean_environment() {
    let scene = scene();
    let network = shell(&scene, "chat", "curl -sS -m 5 https://example.com -o /dev/null", None).await;
    assert_ne!(network.exit_code, Some(0));
    let listen = shell(&scene, "chat", "perl -MIO::Socket::INET -e 'IO::Socket::INET->new(LocalPort=>47999,Listen=>1) or die $!'", None).await;
    assert_ne!(listen.exit_code, Some(0), "it can't listen either");
    std::env::set_var("MISTY_TEST_SECRET_VALUE", "visible");
    let environment = shell(&scene, "chat", "env", None).await;
    assert!(!environment.stdout.contains("MISTY_TEST_SECRET_VALUE"));
    let names: Vec<&str> = environment
        .stdout
        .lines()
        .filter_map(|line| line.split('=').next())
        .filter(|name| !matches!(*name, "PWD" | "SHLVL" | "_" | "OLDPWD"))
        .collect();
    assert_eq!(names.len(), 5, "only what Misty set: {names:?}");
}

#[tokio::test]
async fn nothing_it_started_outlives_a_timeout() {
    let scene = scene();
    let outcome = run(
        &scene.misty,
        ShellRequest {
            workspace_key: "chat".into(),
            command: "perl -e 'use POSIX; if (fork()==0) { POSIX::setsid(); open(F,\">detached.pid\"); print F $$; close F; sleep 300 } ; sleep 300'".into(),
            timeout: Some(Duration::from_secs(2)),
            folder: None,
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await
    .unwrap();
    assert!(outcome.timed_out);
    assert_eq!(outcome.exit_code, None);
    let workspace = workspace::prepare(&scene.misty, "chat").unwrap();
    let pid: i32 = fs::read_to_string(workspace.join("detached.pid")).unwrap().trim().parse().unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "the detached child was stopped too");
}

#[tokio::test]
async fn system_tools_work_inside_the_wall() {
    let scene = scene();
    for command in ["awk 'BEGIN{print 1+1}'", "echo a,b | cut -d, -f2", "printf 'b\\na\\n' | sort", "tar --version", "perl -e 'print 1'"] {
        let outcome = shell(&scene, "chat", command, None).await;
        assert_eq!(outcome.exit_code, Some(0), "{command}: {}", outcome.stderr);
    }
}

#[tokio::test]
async fn forgetting_a_chat_keeps_the_shared_folder() {
    let scene = scene();
    let folder = Some((scene.folder.as_path(), true));
    shell(&scene, "chat", "echo x > w.txt", folder).await;
    forget_workspace(&scene.misty, "chat").unwrap();
    let fresh = shell(&scene, "chat", "ls w.txt", None).await;
    assert_ne!(fresh.exit_code, Some(0));
    assert!(scene.folder.join("a.txt").exists(), "a link is removed, not followed");
    forget_workspace(&scene.misty, "never-existed").unwrap();
}

#[tokio::test]
async fn bad_requests_are_refused() {
    let scene = scene();
    let empty = run(
        &scene.misty,
        ShellRequest { workspace_key: "chat".into(), command: "  ".into(), timeout: None, folder: None },
        Arc::new(AtomicBool::new(false)),
    );
    assert_eq!(empty.await.unwrap_err(), "shell_command_empty");
    let keyless = run(
        &scene.misty,
        ShellRequest { workspace_key: " ".into(), command: "true".into(), timeout: None, folder: None },
        Arc::new(AtomicBool::new(false)),
    );
    assert_eq!(keyless.await.unwrap_err(), "shell_workspace_missing");
}
