//! Escape attempts against the command sandbox. Windows only; commands run
//! under cmd.exe. Node comes from a scratch toolchain folder, so the tests
//! never share the person's own toolchains with a sandbox.
#![cfg(windows)]
mod common;

use std::{fs, path::Path, time::Duration};

use common::{failed, plain, Fixture};
use misty_agent_code::{sandbox::ToolFolder, CodeService};
use serde_json::{json, Value};

const NODE: &str = r"C:\Program Files\nodejs\node.exe";

fn exit(value: &Value) -> i64 {
    value["exitCode"].as_i64().unwrap_or(-999)
}

fn output(value: &Value) -> &str {
    value["output"].as_str().unwrap_or("")
}

/// A project whose commands have node, when this computer has it.
fn fixture() -> (Fixture, tempfile::TempDir) {
    let mut f = common::fixture();
    let tools = tempfile::tempdir().unwrap();
    if Path::new(NODE).exists() {
        fs::copy(NODE, tools.path().join("node.exe")).unwrap();
    }
    let folder = plain(&tools.path().canonicalize().unwrap());
    f.service = CodeService::new(
        plain(&f.data_dir.path().canonicalize().unwrap()),
        std::env::var_os("USERPROFILE").map(Into::into),
    )
    .with_tools(vec![ToolFolder {
        entry: folder.clone(),
        roots: vec![folder],
    }]);
    (f, tools)
}

fn has_node(tools: &tempfile::TempDir) -> bool {
    tools.path().join("node.exe").exists()
}

#[tokio::test(flavor = "multi_thread")]
async fn commands_run_in_the_project() {
    let (f, _tools) = fixture();
    let result = f.run("cd && echo built> out.txt && type out.txt").await;
    assert_eq!(exit(&result), 0, "{result}");
    assert!(output(&result).contains("built"));
    // Commands start on a drive whose root is the project.
    assert!(output(&result).starts_with(|c: char| c.is_ascii_uppercase()), "{result}");
    assert!(output(&result)[1..].starts_with(":\\"), "{result}");
    // cmd's echo keeps the space before `&&`.
    assert_eq!(fs::read_to_string(f.root().join("out.txt")).unwrap().trim(), "built");
    let failing = f.run("echo nope 1>&2 & exit /b 3").await;
    assert_eq!(exit(&failing), 3, "{failing}");
    assert!(!failed(&failing), "a non-zero exit is a normal result");
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_outside_the_project_are_denied() {
    let (f, _tools) = fixture();
    let target = f.outside.path().join("escaped.txt");
    let result = f.run(&format!("echo pwned> \"{}\"", target.display())).await;
    assert_ne!(exit(&result), 0, "{result}");
    assert!(!target.exists());
    let home = std::env::var("USERPROFILE").unwrap();
    let marker = format!(r"{home}\.misty-sandbox-escape-test");
    let result = f.run(&format!("type nul > \"{marker}\"")).await;
    assert_ne!(exit(&result), 0, "{result}");
    assert!(!Path::new(&marker).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_outside_the_project_are_denied() {
    let (f, _tools) = fixture();
    let secret = f.outside.path().join("secret.txt");
    fs::write(&secret, "TOP SECRET").unwrap();
    let result = f.run(&format!("type \"{}\"", secret.display())).await;
    assert!(!output(&result).contains("TOP SECRET"), "{result}");
    let home = std::env::var("USERPROFILE").unwrap();
    for path in [
        format!(r"{home}\.ssh"),
        format!(r"{home}\Documents"),
        format!(r"{home}\AppData\Roaming"),
        home.clone(),
    ] {
        let result = f.run(&format!("dir \"{path}\"")).await;
        assert_ne!(exit(&result), 0, "{path}: {result}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn git_folder_and_secrets_are_protected() {
    let (f, _tools) = fixture();
    fs::create_dir_all(f.root().join(".git/hooks")).unwrap();
    fs::write(f.root().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    fs::write(f.root().join(".env"), "API_KEY=sk-live").unwrap();
    fs::write(f.root().join(".env.production"), "API_KEY=sk-prod").unwrap();
    fs::write(f.root().join(".env.example"), "API_KEY=").unwrap();
    let hook = f.run(r"echo curl evil> .git\hooks\pre-commit").await;
    assert_ne!(exit(&hook), 0, "{hook}");
    assert!(!f.root().join(".git/hooks/pre-commit").exists());
    let head = f.run(r"echo x>> .git\HEAD").await;
    assert_ne!(exit(&head), 0, "{head}");
    let read_head = f.run(r"type .git\HEAD").await;
    assert_eq!(exit(&read_head), 0, "Git's files stay readable: {read_head}");
    let env = f.run("type .env").await;
    assert!(!output(&env).contains("sk-live"), "{env}");
    let example = f.run("type .env.example").await;
    assert_eq!(exit(&example), 0, "{example}");
    let overwrite = f.run("echo X> .env.production").await;
    assert_ne!(exit(&overwrite), 0, "{overwrite}");
    assert_eq!(fs::read_to_string(f.root().join(".env.production")).unwrap(), "API_KEY=sk-prod");
    let rename = f.run(&format!("cd .. & ren \"{}\" moved", f.root().display())).await;
    assert!(f.root().is_dir(), "{rename}");
    // The person still reads their own secrets.
    assert_eq!(fs::read_to_string(f.root().join(".env")).unwrap(), "API_KEY=sk-live");
}

#[tokio::test(flavor = "multi_thread")]
async fn network_is_closed() {
    let (f, tools) = fixture();
    let curl = f.run("curl.exe -sS --max-time 5 https://example.com").await;
    assert_ne!(exit(&curl), 0, "{curl}");
    if has_node(&tools) {
        let fetch = f
            .run("node -e \"fetch('https://example.com').then(()=>console.log('OPEN'),()=>console.log('closed'))\"")
            .await;
        assert!(output(&fetch).contains("closed"), "{fetch}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn environment_is_replaced() {
    std::env::set_var("MISTY_TEST_SECRET_TOKEN", "do-not-leak");
    let (f, _tools) = fixture();
    let env = f.run("set").await;
    let text = output(&env);
    assert!(!text.contains("do-not-leak"), "{text}");
    assert!(text.contains("CI=1"), "{text}");
    let home = std::env::var("USERPROFILE").unwrap();
    assert!(!text.contains(&format!("HOME={home}\r\n")), "{text}");
}

#[tokio::test(flavor = "multi_thread")]
async fn timeouts_and_stray_children_are_killed() {
    let (f, tools) = fixture();
    if !has_node(&tools) {
        return;
    }
    let started = std::time::Instant::now();
    let slow = f
        .call(
            "code.run",
            json!({ "command": "node -e \"setTimeout(()=>{},30000)\"", "timeoutSeconds": 1 }),
        )
        .await;
    assert_eq!(slow["timedOut"], true, "{slow}");
    let stray = f
        .run("start \"\" /b node -e \"setTimeout(()=>{},60000)\" & echo started")
        .await;
    assert_eq!(exit(&stray), 0, "{stray}");
    assert!(started.elapsed().as_secs() < 15);
}

#[tokio::test(flavor = "multi_thread")]
async fn nothing_outside_can_connect_to_a_command() {
    let (f, tools) = fixture();
    if !has_node(&tools) {
        return;
    }
    let started = f
        .call(
            "code.start",
            json!({ "command": "node -e \"const s=require('net').createServer(c=>c.end('INSIDE'));s.listen(0,'127.0.0.1',()=>require('fs').writeFileSync('port.txt',String(s.address().port)))\"", "name": "listener" }),
        )
        .await;
    let id = started["id"].as_str().unwrap_or_default().to_owned();
    tokio::time::sleep(Duration::from_millis(1500)).await;
    if let Ok(port) = fs::read_to_string(f.root().join("port.txt")) {
        let address = format!("127.0.0.1:{}", port.trim()).parse().unwrap();
        let connected = std::net::TcpStream::connect_timeout(&address, Duration::from_secs(2));
        assert!(connected.is_err(), "the listener was reachable from outside");
    }
    f.call("code.stop", json!({ "id": id })).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn watchers_run_in_the_background_until_stopped() {
    let (f, tools) = fixture();
    if !has_node(&tools) {
        return;
    }
    let started = f
        .call(
            "code.start",
            json!({ "command": "node -e \"setInterval(()=>{require('fs').writeFileSync('stamp.txt',String(Date.now()));console.log('tick')},300)\"", "name": "watcher" }),
        )
        .await;
    let id = started["id"].as_str().unwrap().to_owned();
    assert_eq!(started["running"], true, "{started}");
    tokio::time::sleep(Duration::from_millis(800)).await;
    let logs = f.call("code.logs", json!({ "id": id })).await;
    assert!(logs["logs"].as_str().unwrap().contains("tick"), "{logs}");
    assert!(f.root().join("stamp.txt").exists());
    let listed = f.call("code.processes", json!({})).await;
    assert_eq!(listed["processes"].as_array().unwrap().len(), 1);
    assert_eq!(f.call("code.stop", json!({ "id": id })).await["stopped"], true);
    let before = fs::read_to_string(f.root().join("stamp.txt")).unwrap();
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert_eq!(
        fs::read_to_string(f.root().join("stamp.txt")).unwrap(),
        before,
        "stopped means stopped"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn node_runs_from_the_shared_toolchain() {
    let (f, tools) = fixture();
    if !has_node(&tools) {
        return;
    }
    let result = f
        .run("node -e \"console.log(require('path').join('a','b'))\"")
        .await;
    assert_eq!(exit(&result), 0, "{result}");
    assert!(output(&result).contains(r"a\b"), "{result}");
}

#[tokio::test(flavor = "multi_thread")]
async fn detached_children_stop_with_their_command() {
    let (f, tools) = fixture();
    if !has_node(&tools) {
        return;
    }
    let result = f
        .call(
            "code.run",
            json!({ "command": "start \"\" /b node -e \"setInterval(()=>require('fs').appendFileSync('ticks.txt','t\\n'),200)\" & node -e \"setTimeout(()=>console.log('parent done'),1000)\"", "timeoutSeconds": 20 }),
        )
        .await;
    assert_eq!(exit(&result), 0, "{result}");
    tokio::time::sleep(Duration::from_millis(600)).await;
    let before = fs::read_to_string(f.root().join("ticks.txt")).unwrap_or_default();
    tokio::time::sleep(Duration::from_millis(1200)).await;
    let after = fs::read_to_string(f.root().join("ticks.txt")).unwrap_or_default();
    assert!(!before.is_empty(), "the child ran");
    assert_eq!(before, after, "the detached child was stopped");
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_the_project_undoes_its_sandbox() {
    let (f, _tools) = fixture();
    fs::create_dir_all(f.root().join(".git")).unwrap();
    fs::write(f.root().join(".env"), "API_KEY=x").unwrap();
    let rules = |path: &Path| {
        let listed = std::process::Command::new("icacls").arg(path).output().unwrap();
        String::from_utf8_lossy(&listed.stdout).replace(&*path.to_string_lossy(), "")
    };
    let before = [rules(&f.root()), rules(&f.root().join(".git")), rules(&f.root().join(".env"))];
    assert_eq!(exit(&f.run("echo ok").await), 0);
    assert_ne!(rules(&f.root()), before[0], "the project was shared with its sandbox");
    f.service.forget(&f.project.scope_id);
    let after = [rules(&f.root()), rules(&f.root().join(".git")), rules(&f.root().join(".env"))];
    assert_eq!(after, before);
}

