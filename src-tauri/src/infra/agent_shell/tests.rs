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

/// Not a test of its own: `a_crash_stops_running_commands` runs this in a second process and kills
/// that process, which is the only honest way to see what a crash leaves behind.
#[tokio::test]
#[ignore = "started by a_crash_stops_running_commands"]
async fn crash_victim() {
    let Ok(misty) = std::env::var("MISTY_SHELL_CRASH_HOME") else {
        return;
    };
    let _ = run(
        Path::new(&misty),
        ShellRequest {
            workspace_key: "chat".into(),
            command: "sleep 300 & echo $! > background.pid; echo $$ > leader.pid; wait".into(),
            timeout: Some(Duration::from_secs(300)),
            folder: None,
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await;
}

fn read_pid(path: &Path) -> Option<i32> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

#[test]
fn a_crash_stops_running_commands() {
    let scene = scene();
    let workspace = workspace::prepare(&scene.misty, "chat").unwrap();
    // Test names leave out the crate, which `module_path!` starts with.
    let module = module_path!().split_once("::").unwrap().1;
    let mut victim = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", &format!("{module}::crash_victim"), "--ignored"])
        .env("MISTY_SHELL_CRASH_HOME", &scene.misty)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();

    let started = std::time::Instant::now();
    let (leader, background) = loop {
        if let (Some(leader), Some(background)) =
            (read_pid(&workspace.join("leader.pid")), read_pid(&workspace.join("background.pid")))
        {
            break (leader, background);
        }
        assert!(started.elapsed() < Duration::from_secs(60), "the command never started");
        std::thread::sleep(Duration::from_millis(50));
    };
    let alive = |pid: i32| unsafe { libc::kill(pid, 0) == 0 };
    assert!(alive(leader) && alive(background), "both run until the crash");

    victim.kill().unwrap();
    victim.wait().unwrap();

    let crashed = std::time::Instant::now();
    while (alive(leader) || alive(background)) && crashed.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!alive(leader), "the command stopped with the app");
    assert!(!alive(background), "so did what it left in the background");
}

#[tokio::test]
async fn a_writable_folder_holds_links_quarantine_and_files_that_run_by_themselves() {
    let scene = scene();
    let folder = Some((scene.folder.as_path(), true));
    let tried = shell(
        &scene,
        "chat",
        "ln shared-folder/a.txt held; echo link=$?; \
         mkdir shared-folder/.githooks; echo githooks=$?; \
         mkdir shared-folder/.husky; echo husky=$?; \
         echo x > shared-folder/.envrc; echo envrc=$?; \
         mkdir -p shared-folder/.git/hooks; echo git=$?; \
         xattr -w user.note x shared-folder/a.txt; echo xattr=$?; \
         mkdir shared-folder/out; echo mkdir=$?; \
         echo new > shared-folder/out/new.txt; echo add=$?; \
         git init -q private-repo; echo private_git=$?",
        folder,
    )
    .await;
    for refused in ["link=1", "githooks=1", "husky=1", "envrc=1", "git=1", "xattr=1"] {
        assert!(tried.stdout.contains(refused), "{refused} in {}", tried.stdout);
    }
    for works in ["mkdir=0", "add=0", "private_git=0"] {
        assert!(tried.stdout.contains(works), "{works} in {}", tried.stdout);
    }
}

#[tokio::test]
async fn launchctl_cant_be_started() {
    let scene = scene();
    let tried = shell(&scene, "chat", "launchctl print-disabled user/$(id -u) >/dev/null 2>&1; echo status=$?", None).await;
    assert!(!tried.stdout.contains("status=0"), "{}", tried.stdout);
}

#[tokio::test]
async fn system_databases_stay_closed() {
    let scene = scene();
    let tried = shell(&scene, "chat", "ls /opt/homebrew/var >/dev/null 2>&1; echo var=$?; ls /opt/homebrew/bin >/dev/null 2>&1; echo status=$?", None).await;
    if Path::new("/opt/homebrew/var").exists() {
        assert!(!tried.stdout.contains("var=0"), "{}", tried.stdout);
    }
}

#[tokio::test]
async fn nothing_from_misty_leaks_into_a_command() {
    let scene = scene();
    // Asked of the shell itself: `ls` would count the folder it opens to answer.
    let tried = shell(&scene, "chat", "for fd in $(seq 3 256); do [ -e /dev/fd/$fd ] && echo $fd; done; true", None).await;
    assert_eq!(tried.stdout.trim(), "", "files left open in a command");
    let limit = shell(&scene, "chat", "ulimit -u", None).await;
    assert!(limit.stdout.trim().parse::<u64>().is_ok_and(|limit| limit < 100_000), "{}", limit.stdout);
    let forks = shell(&scene, "chat", "(sleep 0 & wait); echo status=$?", None).await;
    assert!(forks.stdout.contains("status=0"), "a command can still start processes: {}", forks.stdout);
}

#[tokio::test]
async fn a_workspace_that_fills_up_stops_its_command() {
    let scene = scene();
    let workspace = workspace::prepare(&scene.misty, "chat").unwrap();
    fs::write(workspace.join("big"), vec![0u8; 2048]).unwrap();
    let (stop, full) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    tokio::time::timeout(
        Duration::from_secs(10),
        workspace::stop_when_full(workspace, 1024, stop.clone(), full.clone()),
    )
    .await
    .unwrap();
    assert!(stop.load(Ordering::Acquire) && full.load(Ordering::Acquire));
}

#[tokio::test]
async fn a_command_cant_reach_anothers_workspace_by_its_key() {
    let scene = scene();
    assert_ne!(
        workspace::prepare(&scene.misty, "account-a\nchat").unwrap(),
        workspace::prepare(&scene.misty, "account-b\nchat").unwrap()
    );
}

fn sleeping_group() -> std::process::Child {
    use std::os::unix::process::CommandExt;
    std::process::Command::new("/bin/sleep").arg("300").process_group(0).spawn().unwrap()
}

#[tokio::test]
async fn stopping_the_watcher_leaves_the_group_alone() {
    let mut group = sleeping_group();
    exit_watcher::ExitWatcher::start(group.id() as i32).unwrap().stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(group.try_wait().unwrap().is_none(), "a finished command's number is never killed");
    group.kill().unwrap();
    group.wait().unwrap();
}

#[tokio::test]
async fn dropping_the_watcher_stops_the_group() {
    let mut group = sleeping_group();
    drop(exit_watcher::ExitWatcher::start(group.id() as i32).unwrap());
    let dropped = std::time::Instant::now();
    while group.try_wait().unwrap().is_none() {
        assert!(dropped.elapsed() < Duration::from_secs(5), "a cancelled run cleans up");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
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
