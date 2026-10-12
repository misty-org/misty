#![allow(dead_code)]
use std::path::PathBuf;

use misty_agent_code::{CodeService, Project};
use serde_json::{json, Value};

pub struct Fixture {
    pub project_dir: tempfile::TempDir,
    pub data_dir: tempfile::TempDir,
    pub outside: tempfile::TempDir,
    pub service: CodeService,
    pub project: Project,
}

pub fn fixture() -> Fixture {
    let project_dir = tempfile::tempdir().unwrap();
    let data_dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let root = project_dir.path().canonicalize().unwrap();
    let service = CodeService::new(
        data_dir.path().canonicalize().unwrap(),
        std::env::var_os("HOME").map(PathBuf::from),
    );
    let project = Project {
        scope_id: "scope_test".into(),
        root,
        allow_installs: false,
    };
    Fixture {
        project_dir,
        data_dir,
        outside,
        service,
        project,
    }
}

impl Fixture {
    pub fn root(&self) -> PathBuf {
        self.project.root.clone()
    }

    pub async fn call(&self, operation: &str, input: Value) -> Value {
        misty_agent_code::outcome(self.service.execute(&self.project, "run_1", operation, input).await)
            .unwrap_or_else(|error| json!({ "jobError": error }))
    }

    pub async fn run(&self, command: &str) -> Value {
        self.call("code.run", json!({ "command": command, "timeoutSeconds": 20 })).await
    }
}

pub fn failed(value: &Value) -> bool {
    value["status"] == "failure" || value.get("jobError").is_some()
}
