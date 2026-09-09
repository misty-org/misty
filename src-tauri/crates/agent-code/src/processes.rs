//! Long-running commands: build watchers and test runners an agent starts,
//! reads the logs of, and stops. (Commands can't listen on ports, so there
//! are no dev servers; previews come from Misty's own server.) Each belongs to one project and is stopped when it
//! outlives its time limit, when its project is removed, or when Misty quits.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::process::Child;

use crate::{exec, output::Capped, sandbox::Setup, CodeError};

const PER_PROJECT: usize = 3;
const MAX_LIFETIME: Duration = Duration::from_secs(2 * 3600);
const LOG_HEAD: usize = 4 * 1024;
const LOG_TAIL: usize = 60 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub command: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRequest {
    pub id: String,
}

struct Running {
    scope_id: String,
    name: String,
    command: String,
    pid: Option<u32>,
    started: Instant,
    logs: Arc<Mutex<Capped>>,
    child: Arc<tokio::sync::Mutex<Child>>,
    exit: Arc<Mutex<Option<Option<i32>>>>,
    tree: crate::tree::Tree,
}

#[derive(Default, Clone)]
pub struct Registry {
    running: Arc<Mutex<HashMap<String, Running>>>,
}

impl Registry {
    fn reap(&self) {
        let expired: Vec<String> = self
            .running
            .lock()
            .map(|running| {
                running
                    .iter()
                    .filter(|(_, process)| process.started.elapsed() > MAX_LIFETIME)
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for id in expired {
            self.remove(&id);
        }
    }

    fn remove(&self, id: &str) -> Option<Running> {
        let process = self.running.lock().ok()?.remove(id)?;
        process.kill();
        Some(process)
    }

    fn status(process: &Running) -> Value {
        let exit = process.exit.lock().ok().and_then(|exit| *exit);
        let bytes = process.logs.lock().map(|logs| logs.total()).unwrap_or_default();
        json!({
            "name": process.name,
            "command": process.command,
            "running": exit.is_none(),
            "exitCode": exit.flatten(),
            "minutes": process.started.elapsed().as_secs() / 60,
            "logBytes": bytes,
        })
    }

    pub async fn start(
        &self,
        scope_id: &str,
        request: &StartRequest,
        setup: Setup,
    ) -> Result<Value, CodeError> {
        self.reap();
        exec::check_command(&request.command)?;
        let count = self
            .running
            .lock()
            .map(|running| running.values().filter(|p| p.scope_id == scope_id).count())
            .unwrap_or(0);
        if count >= PER_PROJECT {
            return Err(CodeError::fix(format!(
                "This project already has {PER_PROJECT} processes running. Stop one with code_stop first (see code_processes)."
            )));
        }
        let mut child = exec::spawn(&setup)?;
        let pid = child.id();
        let tree = crate::tree::Tree::watch(pid);
        let logs = Arc::new(Mutex::new(Capped::new(LOG_HEAD, LOG_TAIL)));
        exec::collect(&mut child, logs.clone());
        let child = Arc::new(tokio::sync::Mutex::new(child));
        let exit = Arc::new(Mutex::new(None));
        {
            let child = child.clone();
            let exit = exit.clone();
            tokio::spawn(async move {
                let status = child.lock().await.wait().await;
                if let Ok(mut exit) = exit.lock() {
                    *exit = Some(status.ok().and_then(|status| status.code()));
                }
            });
        }
        let id = format!("proc_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let name = request
            .name
            .clone()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| request.command.chars().take(60).collect());
        self.running.lock().map_err(|_| CodeError::fix("busy"))?.insert(
            id.clone(),
            Running {
                scope_id: scope_id.to_owned(),
                name,
                command: request.command.chars().take(300).collect(),
                pid,
                started: Instant::now(),
                logs,
                child,
                exit,
                tree,
            },
        );
        // Wait briefly so a crash or the first output shows right away.
        for _ in 0..8 {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let exited = self
                .running
                .lock()
                .ok()
                .and_then(|running| {
                    running
                        .get(&id)
                        .map(|process| process.exit.lock().map(|exit| exit.is_some()).unwrap_or(false))
                })
                .unwrap_or(true);
            if exited {
                break;
            }
        }
        let mut status = self.logs(scope_id, &id)?;
        status["id"] = json!(id);
        Ok(status)
    }

    pub fn logs(&self, scope_id: &str, id: &str) -> Result<Value, CodeError> {
        let running = self.running.lock().map_err(|_| CodeError::fix("busy"))?;
        let process = running
            .get(id)
            .filter(|process| process.scope_id == scope_id)
            .ok_or_else(|| CodeError::fix(format!("No process {id} in this project. List them with code_processes.")))?;
        let mut status = Self::status(process);
        status["id"] = json!(id);
        status["logs"] = json!(process.logs.lock().map(|logs| logs.render()).unwrap_or_default());
        Ok(status)
    }

    pub fn list(&self, scope_id: &str) -> Value {
        self.reap();
        let running = self.running.lock();
        let processes: Vec<Value> = running
            .map(|running| {
                running
                    .iter()
                    .filter(|(_, process)| process.scope_id == scope_id)
                    .map(|(id, process)| {
                        let mut status = Self::status(process);
                        status["id"] = json!(id);
                        status
                    })
                    .collect()
            })
            .unwrap_or_default();
        json!({ "processes": processes })
    }

    pub async fn stop(&self, scope_id: &str, id: &str) -> Result<Value, CodeError> {
        let owned = self
            .running
            .lock()
            .map(|running| running.get(id).is_some_and(|p| p.scope_id == scope_id))
            .unwrap_or(false);
        if !owned {
            return Err(CodeError::fix(format!("No process {id} in this project.")));
        }
        let process = self.remove(id).ok_or_else(|| CodeError::fix("Already stopped."))?;
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            process.child.lock().await.kill().await
        })
        .await;
        Ok(json!({ "id": id, "stopped": true }))
    }

    /// Stops every process of one project, or of all projects.
    pub fn stop_all(&self, scope_id: Option<&str>) {
        let ids: Vec<String> = self
            .running
            .lock()
            .map(|running| {
                running
                    .iter()
                    .filter(|(_, p)| scope_id.is_none_or(|scope| p.scope_id == scope))
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for id in ids {
            self.remove(&id);
        }
    }

}

impl Running {
    /// Kills the process group, unless it already exited: its id could by
    /// now belong to an unrelated process.
    fn kill(&self) {
        let exited = self.exit.lock().map(|exit| exit.is_some()).unwrap_or(false);
        if !exited {
            exec::kill_group(self.pid);
        }
        self.tree.kill_all();
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.kill();
    }
}

