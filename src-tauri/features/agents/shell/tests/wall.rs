//! What a command can reach: tools, installed software, the shared folder and other workspaces.
use super::*;

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
         mkdir shared-folder/out; echo mkdir=$?; \
         echo new > shared-folder/out/new.txt; echo add=$?; \
         mkdir -p private/.git/hooks; echo private_git=$?",
        folder,
    )
    .await;
    for refused in ["link=1", "githooks=1", "husky=1", "envrc=1", "git=1"] {
        assert!(
            tried.stdout.contains(refused),
            "{refused} in {}",
            tried.stdout
        );
    }
    for works in ["mkdir=0", "add=0", "private_git=0"] {
        assert!(tried.stdout.contains(works), "{works} in {}", tried.stdout);
    }
}

/// What keeps commands from reading other programs' environments, turning off login items or running
/// something an agent wrote: nothing but Misty's own tools can start.
#[tokio::test]
async fn only_mistys_own_tools_can_start() {
    let scene = scene();
    for program in [
        "/usr/bin/perl -e 'print 1'",
        "/usr/bin/python3 -c 'print(1)'",
        "/usr/bin/git --version",
        "/bin/launchctl print-disabled user/501",
        "/bin/ls /",
        "/bin/sh -c 'echo escaped'",
        "/usr/bin/true",
        "/usr/bin/ssh -V",
    ] {
        let outcome = shell(&scene, "chat", program, None).await;
        assert_ne!(
            outcome.exit_code,
            Some(0),
            "{program} started: {}",
            outcome.stdout
        );
        assert!(!outcome.stdout.contains("escaped"), "{program}");
    }
    let copied = shell(
        &scene,
        "chat",
        "cp \"$(command -v cat)\" ./mine; ./mine r.txt; echo mine=$?; \
         printf '#!/bin/sh\\necho escaped\\n' > x; chmod +x x; ./x; echo script=$?",
        None,
    )
    .await;
    assert!(
        !copied.stdout.contains("mine=0"),
        "a copy of a tool isn't the tool: {}",
        copied.stdout
    );
    assert!(!copied.stdout.contains("script=0"), "{}", copied.stdout);
    assert!(!copied.stdout.contains("escaped"), "{}", copied.stdout);
}

#[tokio::test]
async fn what_the_computer_has_installed_stays_closed() {
    let scene = scene();
    for folder in [
        "/usr/bin",
        "/bin",
        "/opt/homebrew",
        "/usr/local",
        "/Applications",
        "/Users",
    ] {
        if !Path::new(folder).exists() {
            continue;
        }
        let outcome = shell(&scene, "chat", &format!("ls {folder}"), None).await;
        assert_ne!(
            outcome.exit_code,
            Some(0),
            "{folder} was listed: {}",
            outcome.stdout
        );
    }
}

#[tokio::test]
async fn what_a_command_adds_to_a_shared_folder_is_quarantined() {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let scene = scene();
    file_access::allow_shared_folder(&scene.folder, file_access::Access::Read);
    // Files the fixture just made would count as changed by the command.
    tokio::time::sleep(Duration::from_secs(3)).await;
    shell(
        &scene,
        "chat",
        "echo planted > shared-folder/x.command",
        Some((scene.folder.as_path(), true)),
    )
    .await;
    let file = CString::new(scene.folder.join("x.command").as_os_str().as_bytes()).unwrap();
    let size = unsafe {
        libc::getxattr(
            file.as_ptr(),
            c"com.apple.quarantine".as_ptr(),
            std::ptr::null_mut(),
            0,
            0,
            0,
        )
    };
    assert!(size > 0, "the added file carries the flag");
    let untouched = CString::new(scene.folder.join("sub/b.txt").as_os_str().as_bytes()).unwrap();
    let size = unsafe {
        libc::getxattr(
            untouched.as_ptr(),
            c"com.apple.quarantine".as_ptr(),
            std::ptr::null_mut(),
            0,
            0,
            0,
        )
    };
    assert!(size < 0, "and a file it didn't touch doesn't");
}

#[tokio::test]
async fn nothing_from_misty_leaks_into_a_command() {
    let scene = scene();
    // Asked of a tool: the shell's own runtime has files open that it marks to close on exec, and the
    // tool's only other file is the folder it opened to answer.
    let tried = shell(&scene, "chat", "ls /dev/fd", None).await;
    let open: Vec<i32> = tried
        .stdout
        .split_whitespace()
        .filter_map(|fd| fd.parse().ok())
        .collect();
    assert!(
        open.iter().all(|fd| *fd <= 3),
        "files left open in a command: {open:?}"
    );
    let limit = shell(&scene, "chat", "ulimit -u", None).await;
    assert!(
        limit
            .stdout
            .trim()
            .parse::<u64>()
            .is_ok_and(|limit| limit < 100_000),
        "{}",
        limit.stdout
    );
    let forks = shell(&scene, "chat", "(sleep 0 & wait); echo status=$?", None).await;
    assert!(
        forks.stdout.contains("status=0"),
        "a command can still start processes: {}",
        forks.stdout
    );
}

#[tokio::test]
async fn a_workspace_that_fills_up_stops_its_command() {
    let scene = scene();
    let workspace = workspace::prepare(&scene.misty, "chat").unwrap();
    fs::write(workspace.join("big"), vec![0u8; 2048]).unwrap();
    let (stop, full) = (
        Arc::new(AtomicBool::new(false)),
        Arc::new(AtomicBool::new(false)),
    );
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
    std::process::Command::new("/bin/sleep")
        .arg("300")
        .process_group(0)
        .spawn()
        .unwrap()
}

#[tokio::test]
async fn stopping_the_watcher_leaves_the_group_alone() {
    let mut group = sleeping_group();
    exit_watcher::ExitWatcher::start(group.id() as i32)
        .unwrap()
        .stop()
        .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        group.try_wait().unwrap().is_none(),
        "a finished command's number is never killed"
    );
    group.kill().unwrap();
    group.wait().unwrap();
}

#[tokio::test]
async fn dropping_the_watcher_stops_the_group() {
    let mut group = sleeping_group();
    drop(exit_watcher::ExitWatcher::start(group.id() as i32).unwrap());
    let dropped = std::time::Instant::now();
    while group.try_wait().unwrap().is_none() {
        assert!(
            dropped.elapsed() < Duration::from_secs(5),
            "a cancelled run cleans up"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tokio::test]
async fn system_tools_work_inside_the_wall() {
    let scene = scene();
    for command in [
        "echo a,b | cut -d, -f2",
        "printf 'b\\na\\n' | sort | uniq | wc -l",
        "seq 3 | grep 2 | sed s/2/two/",
        "mkdir -p t/u && echo x > t/u/f && find t -name f | xargs cat",
        "tar -czf t.tgz t && tar -tzf t.tgz > /dev/null",
        "zip -r t.zip t > /dev/null && unzip -q t.zip -d out && cat out/t/u/f",
        "echo x | gzip | gunzip",
        "for i in 1 2; do echo $i; done | tail -1",
        "printf 'echo from a script\\n' > r.sh && sh r.sh",
    ] {
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
    assert!(
        scene.folder.join("a.txt").exists(),
        "a link is removed, not followed"
    );
    forget_workspace(&scene.misty, "never-existed").unwrap();
}

#[tokio::test]
async fn bad_requests_are_refused() {
    let scene = scene();
    let empty = run(
        &scene.misty,
        ShellRequest {
            workspace_key: "chat".into(),
            command: "  ".into(),
            timeout: None,
            folder: None,
        },
        Arc::new(AtomicBool::new(false)),
    );
    assert_eq!(empty.await.unwrap_err(), "shell_command_empty");
    let keyless = run(
        &scene.misty,
        ShellRequest {
            workspace_key: " ".into(),
            command: "true".into(),
            timeout: None,
            folder: None,
        },
        Arc::new(AtomicBool::new(false)),
    );
    assert_eq!(keyless.await.unwrap_err(), "shell_workspace_missing");
}
