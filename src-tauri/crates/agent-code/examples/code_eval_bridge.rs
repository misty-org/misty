//! The code eval's bridge (server/apps/agent-runtime/evals/code): runs code
//! tools for one project through the same service and sandbox the desktop
//! uses, one JSON request per stdin line, one JSON reply per stdout line.
//!
//!   code_eval_bridge --project DIR --data DIR [--installs]
//!   {"id":1,"operation":"code.read","input":{"path":"index.html"}}
//!   {"id":1,"result":{...}}  or  {"id":1,"error":"..."}
use std::path::PathBuf;

use misty_agent_code::{outcome, CodeService, Project};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let value = |flag: &str| {
        args.iter()
            .position(|arg| arg == flag)
            .and_then(|index| args.get(index + 1))
            .map(PathBuf::from)
            .unwrap_or_else(|| panic!("{flag} is required"))
    };
    let root = value("--project").canonicalize().expect("project folder");
    let data = value("--data");
    std::fs::create_dir_all(&data).expect("data folder");
    let service = CodeService::new(data.canonicalize().unwrap(), std::env::var_os("HOME").map(PathBuf::from));
    let project = Project {
        scope_id: "scope_eval".into(),
        root,
        allow_installs: args.iter().any(|arg| arg == "--installs"),
    };
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    while let Ok(Some(line)) = lines.next_line().await {
        let request: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let id = request["id"].clone();
        let reply = match request["operation"].as_str() {
            Some("undo") => match service.undo(&project, request["runId"].as_str().unwrap_or("run_eval")) {
                Ok(result) => json!({ "id": id, "result": result }),
                Err(error) => json!({ "id": id, "error": error.to_string() }),
            },
            Some(operation) => match outcome(
                service
                    .execute(&project, "run_eval", operation, request["input"].clone())
                    .await,
            ) {
                Ok(result) => json!({ "id": id, "result": result }),
                Err(error) => json!({ "id": id, "error": error }),
            },
            None => json!({ "id": id, "error": "bad request" }),
        };
        let mut text = reply.to_string();
        text.push('\n');
        if stdout.write_all(text.as_bytes()).await.is_err() || stdout.flush().await.is_err() {
            break;
        }
    }
    service.shutdown();
}
