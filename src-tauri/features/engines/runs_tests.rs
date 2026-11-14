use super::summarize;
use serde_json::json;

#[test]
fn an_agy_write_names_its_file() {
    // The `rawInput` of agy 1.5.9's `session/request_permission` for a `write_file` call, whose
    // title is "File hello.txt".
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
    // A command outranks a path when an ask names both.
    assert_eq!(summarize(&json!({ "path": "/ws", "command": "ls" })), "ls");
    assert_eq!(summarize(&json!("plain")), "");
    let long = "x".repeat(700);
    assert_eq!(summarize(&json!({ "url": long })).chars().count(), 601);
}
