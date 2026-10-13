//! View-owned transfer jobs. The Host starts them (see `host_files`); Apps can
//! only follow, cancel or close a job that belongs to their own instance.
use super::PermissionSet;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

pub struct TransferJob {
    pub(super) state: Arc<Mutex<Value>>,
    pub(super) cancel: Arc<AtomicBool>,
}
impl Drop for TransferJob {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}
pub fn execute(p: &mut PermissionSet, method: &str, params: &Value) -> Result<Value, String> {
    p.authorize("files.write")?;
    let id = params
        .get("jobId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or("Missing transfer handle.")?;
    let job = p
        .transfers
        .get(id)
        .ok_or("This transfer belongs to another App or has closed.")?;
    match method {
        "files.transferStatus" => Ok(job
            .state
            .lock()
            .map_err(|_| "Transfer status unavailable.")?
            .clone()),
        "files.transferCancel" => {
            job.cancel.store(true, Ordering::Release);
            Ok(Value::Null)
        }
        "files.transferClose" => {
            p.transfers.remove(id);
            Ok(Value::Null)
        }
        _ => Err("Unknown transfer operation.".into()),
    }
}
