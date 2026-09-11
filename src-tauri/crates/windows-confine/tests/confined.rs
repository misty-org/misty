//! These tests change folder permissions, so they only ever touch folders
//! they create, and a guard takes every rule away again even when a test
//! fails.
#![cfg(windows)]
use std::{
    ffi::OsString,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

use misty_windows_confine::{
    environment_block, pipe, spawn, system_variables, Access, Capability, Container, Job,
    JobLimits, Launch, Process,
};

const CMD: &str = r"C:\Windows\System32\cmd.exe";
const NODE: &str = r"C:\Program Files\nodejs\node.exe";

/// A scratch folder whose rules are all removed on drop. Its `tools` folder
/// stands in for an installed toolchain: open to holders of the test
/// capability only.
struct Scratch {
    container: Container,
    tools: Capability,
    folder: tempfile::TempDir,
    granted: Vec<PathBuf>,
    limited: Vec<(PathBuf, String)>,
}

impl Scratch {
    fn new() -> Self {
        let scratch = Self {
            container: Container::open("Misty.ConfineTest").unwrap(),
            tools: Capability::named("mistyConfineTestTools").unwrap(),
            folder: tempfile::tempdir().unwrap(),
            granted: Vec::new(),
            limited: Vec::new(),
        };
        let tools = scratch.path("tools");
        std::fs::create_dir_all(&tools).unwrap();
        std::fs::write(tools.join("hello.cmd"), "@echo hello-tool").unwrap();
        if Path::new(NODE).exists() {
            std::fs::copy(NODE, tools.join("node.exe")).unwrap();
        }
        scratch.tools.grant(&tools, Access::ReadExecute).unwrap();
        scratch
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.folder.path().join(relative)
    }

    fn owned(&self, path: &Path) {
        assert!(path.starts_with(self.folder.path()), "{}", path.display());
    }

    fn grant(&mut self, path: &Path, access: Access) {
        self.owned(path);
        self.granted.push(path.to_path_buf());
        self.container.grant(path, access).unwrap();
    }

    fn limit(&mut self, path: &Path, access: Option<Access>) {
        self.owned(path);
        if let Some(original) = self.container.limit(path, access).unwrap() {
            self.limited.push((path.to_path_buf(), original));
        }
    }

    /// Runs `command` under cmd.exe in `cwd`, inside the container, with the
    /// tools folder on PATH and, when `tools`, the capability to use it.
    fn start(&self, cwd: &Path, command: &str, job: &Job, tools: bool) -> (File, Process) {
        let path = format!(r"{};C:\Windows\System32", self.path("tools").display());
        let mut variables = system_variables();
        variables.extend([
            (OsString::from("PATH"), OsString::from(path)),
            ("TEMP".into(), cwd.as_os_str().to_owned()),
        ]);
        let environment = environment_block(variables);
        let (read, write) = pipe().unwrap();
        let line = OsString::from(format!("cmd.exe /d /s /c \"{command}\""));
        let held = [&self.tools];
        let process = spawn(&Launch {
            application: Path::new(CMD),
            command_line: &line,
            environment: &environment,
            directory: cwd,
            stdin: None,
            stdout: &write,
            stderr: &write,
            container: &self.container,
            capabilities: if tools { &held } else { &[] },
            job,
        })
        .unwrap();
        (read, process)
    }

    fn run(&self, cwd: &Path, command: &str) -> String {
        let job = job(16);
        let (mut read, process) = self.start(cwd, command, &job, true);
        let code = process.wait(Duration::from_secs(60));
        job.terminate();
        let mut output = String::new();
        let _ = read.read_to_string(&mut output);
        assert!(code.is_some(), "timed out: {output}");
        output
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        for (path, original) in self.limited.iter().rev() {
            let _ = self.container.restore(path, original);
        }
        for path in self.granted.iter().rev() {
            let _ = self.container.forget(path);
        }
        let _ = self.tools.forget(&self.path("tools"));
    }
}

fn job(processes: u32) -> Job {
    Job::new(&JobLimits {
        process_memory: 1 << 30,
        process_cpu: Duration::from_secs(60),
        processes,
    })
    .unwrap()
}

#[test]
fn commands_reach_only_the_project() {
    let mut scratch = Scratch::new();
    let project = scratch.path("project");
    let git = project.join(".git");
    let outside = scratch.path("outside.txt");
    std::fs::create_dir_all(&git).unwrap();
    std::fs::write(git.join("HEAD"), "ref").unwrap();
    std::fs::write(&outside, "outside-secret").unwrap();
    std::fs::write(project.join(".env"), "TOKEN=1").unwrap();
    scratch.grant(&project, Access::Inside);
    scratch.grant(&project, Access::Inside);
    scratch.limit(&git, Some(Access::ReadExecute));
    scratch.limit(&git, Some(Access::ReadExecute));
    scratch.limit(&project.join(".env"), None);
    let command = format!(
        "echo made> made.txt && type made.txt \
         & (type \"{}\" || echo blocked-read) \
         & (type .env || echo blocked-secret) \
         & (echo x> .env || echo blocked-secret-write) \
         & ((echo x> .git\\hook) || echo blocked-git-new) \
         & ((echo x>> .git\\HEAD) || echo blocked-git-change) \
         & type .git\\HEAD \
         & node -e \"fetch('https://example.com').then(()=>console.log('net-open'),()=>console.log('blocked-net'))\"",
        outside.display()
    );
    let output = scratch.run(&project, &command);
    for expected in [
        "made",
        "blocked-read",
        "blocked-secret",
        "blocked-secret-write",
        "blocked-git-new",
        "blocked-git-change",
        "ref",
        "blocked-net",
    ] {
        assert!(output.contains(expected), "{expected}: {output}");
    }
    assert!(
        !output.contains("outside-secret") && !output.contains("TOKEN"),
        "{output}"
    );
    assert_eq!(
        std::fs::read_to_string(project.join(".env")).unwrap(),
        "TOKEN=1"
    );
}

#[test]
fn the_project_folder_itself_survives_its_commands() {
    let mut scratch = Scratch::new();
    let project = scratch.path("project");
    std::fs::create_dir_all(project.join("src")).unwrap();
    scratch.grant(&project, Access::Inside);
    let output = scratch.run(
        &project,
        &format!("rmdir /s /q \"{}\" & echo done", project.display()),
    );
    assert!(output.contains("done"), "{output}");
    assert!(project.is_dir(), "{output}");
    assert!(!project.join("src").exists(), "contents may be removed");
}

#[test]
fn the_job_ends_every_process_it_started() {
    let mut scratch = Scratch::new();
    let folder = scratch.path("run");
    std::fs::create_dir_all(&folder).unwrap();
    scratch.grant(&folder, Access::Full);
    let started = Instant::now();
    let job = job(8);
    // A child that would outlive its parent by half a minute.
    let (_read, process) =
        scratch.start(&folder, "node -e \"setTimeout(()=>{},30000)\"", &job, true);
    assert_eq!(process.wait(Duration::from_millis(500)), None);
    job.terminate();
    assert!(process.wait(Duration::from_secs(5)).is_some());
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn tools_are_reachable_only_with_their_capability() {
    let mut scratch = Scratch::new();
    let folder = scratch.path("run");
    std::fs::create_dir_all(&folder).unwrap();
    scratch.grant(&folder, Access::Full);
    for (tools, expected) in [(false, "not recognized"), (true, "hello-tool")] {
        let job = job(4);
        let (mut read, process) = scratch.start(&folder, "hello", &job, tools);
        process.wait(Duration::from_secs(30));
        let mut output = String::new();
        let _ = read.read_to_string(&mut output);
        assert!(output.contains(expected), "{tools}: {output}");
    }
}

#[test]
fn environment_blocks_are_sorted_and_terminated() {
    let block = environment_block([("b", "2"), ("A", "1"), ("bad=name", "x")]);
    assert_eq!(String::from_utf16(&block).unwrap(), "A=1\0b=2\0\0");
    assert_eq!(environment_block(Vec::<(&str, &str)>::new()), vec![0, 0]);
}

/// A path's DACL, label and flags, as SDDL.
fn sddl(path: &Path) -> String {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-Command"])
        .arg(format!("(Get-Acl -LiteralPath '{}').Sddl", path.display()))
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

#[test]
fn every_change_is_undone_exactly() {
    let mut scratch = Scratch::new();
    let folder = scratch.path("inherits");
    let inside = folder.join("inside");
    let file = inside.join("secret.txt");
    std::fs::create_dir_all(&inside).unwrap();
    std::fs::write(&file, "x").unwrap();
    let now = || [sddl(&folder), sddl(&inside), sddl(&file)];
    let before = now();
    assert!(
        before[0].contains("D:AI") && before[0].contains(";ID;"),
        "{before:?}"
    );
    for access in [Access::Full, Access::Inside, Access::ReadExecute] {
        scratch.grant(&folder, access);
        scratch.grant(&folder, access);
        assert!(
            sddl(&file).contains("S-1-15-2-"),
            "{access:?} reaches inside"
        );
        for (path, narrowed) in [(&file, None), (&inside, Some(Access::ReadExecute))] {
            scratch.limit(path, narrowed);
            assert!(scratch.container.limit(path, narrowed).unwrap().is_none());
        }
        assert!(
            !sddl(&file).contains("S-1-15-2-"),
            "{access:?}: the file is excluded"
        );
        while let Some((path, original)) = scratch.limited.pop() {
            scratch.container.restore(&path, &original).unwrap();
        }
        scratch.container.forget(&folder).unwrap();
        assert_eq!(now(), before, "{access:?}");
    }
}

#[test]
fn commands_on_their_own_drive_can_list_and_delete() {
    let mut scratch = Scratch::new();
    let project = scratch.path("project");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("old.txt"), "x").unwrap();
    scratch.grant(&project, Access::Inside);
    let drive = misty_windows_confine::drive_for(&project).unwrap();
    let again = misty_windows_confine::drive_for(&project).unwrap();
    assert_eq!(drive.root(), again.root(), "one letter per folder");
    let letter = drive.root().to_string_lossy().chars().next().unwrap();
    assert!(misty_windows_confine::is_substituted(letter));
    let output = scratch.run(&drive.root(), "dir /b & del old.txt & echo deleted");
    assert!(
        output.contains("old.txt") && output.contains("deleted"),
        "{output}"
    );
    assert!(!project.join("old.txt").exists(), "{output}");
    drop((drive, again));
    assert!(
        !misty_windows_confine::is_substituted(letter),
        "the letter goes with the last command"
    );
}

#[test]
fn known_capability_names_give_their_well_known_sids() {
    // A helper that may use the internet holds Windows' own internetClient.
    let internet = misty_windows_confine::Capability::named("internetClient").unwrap();
    assert_eq!(internet.sid_string().unwrap(), "S-1-15-3-1");
}
