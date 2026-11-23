use super::summarize;
use serde_json::json;

#[test]
fn an_agy_write_names_its_file() {
    let input = json!({
        "Content": "Hello, world!\n",
        "Path": "/private/tmp/agyprobe/ws/hello.txt",
    });
    assert_eq!(summarize(&input), "/private/tmp/agyprobe/ws/hello.txt");
    let command = json!({ "CommandLine": "ls -la", "WaitMsBeforeAsync": "5000" });
    assert_eq!(summarize(&command), "ls -la");
}

#[test]
fn other_engines_spellings_still_read() {
    assert_eq!(summarize(&json!({ "command": "git status" })), "git status");
    assert_eq!(summarize(&json!({ "file_path": "/a.rs" })), "/a.rs");
    assert_eq!(summarize(&json!({ "filePath": "/b.rs" })), "/b.rs");
    assert_eq!(
        summarize(&json!({ "command": ["bash", "-lc", "make"] })),
        "make"
    );
    assert_eq!(summarize(&json!({ "path": "/ws", "command": "ls" })), "ls");
    assert_eq!(summarize(&json!("plain")), "");
    let long = "x".repeat(700);
    assert_eq!(summarize(&json!({ "url": long })).chars().count(), 601);
}
