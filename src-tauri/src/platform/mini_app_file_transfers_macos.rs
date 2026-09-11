use super::super::directories::{decode_name, encode_name};
use super::*;
use std::{os::fd::AsRawFd, sync::OnceLock};

fn global_slot() -> Result<tokio::sync::OwnedSemaphorePermit, String> {
    static SLOTS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    SLOTS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(8)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Other file transfers are running. Try again shortly.".into())
}

struct Control {
    cancel: Arc<AtomicBool>,
    source_released: Arc<AtomicBool>,
    destination_released: Arc<AtomicBool>,
    permission: tokio::sync::watch::Receiver<u64>,
    state: Arc<Mutex<Value>>,
}
impl Control {
    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Acquire)
            || self.source_released.load(Ordering::Acquire)
            || self.destination_released.load(Ordering::Acquire)
            || self.permission.has_changed().unwrap_or(true)
        {
            Err("Transfer cancelled because its job, folder grant, or App closed.".into())
        } else {
            Ok(())
        }
    }
}
pub(super) fn start(
    p: &mut PermissionSet,
    params: &Value,
    lease: Arc<super::super::document_processing::ServiceLease>,
) -> Result<Value, String> {
    p.authorize("files.read")?;
    if p.transfers.len() >= 16 {
        return Err("Close an old transfer before starting another.".into());
    }
    let key = |name: &str| {
        params
            .get(name)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .ok_or_else(|| format!("Missing {name} grant."))
    };
    let source = p
        .folders
        .get(key("sourceDirectory")?)
        .ok_or("Source folder is not granted to this App.")?;
    let destination = p
        .folders
        .get(key("destinationDirectory")?)
        .ok_or("Destination folder is not granted to this App.")?;
    let moving = match params.get("operation").and_then(Value::as_str) {
        Some("copy") => false,
        Some("move") => true,
        _ => return Err("Choose copy or move.".into()),
    };
    if !destination.writable || moving && !source.writable {
        return Err("Choose the transfer's destination, and move source, for writing.".into());
    }
    let rename_conflict = match params.get("conflict").and_then(Value::as_str) {
        None | Some("error") => false,
        Some("rename") => true,
        _ => return Err("Invalid transfer conflict policy.".into()),
    };
    let name = decode_name(
        params
            .get("entry")
            .and_then(Value::as_str)
            .ok_or("Choose a source entry.")?,
    )?;
    let local_slot = p
        .transfer_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| "This App already has four running transfers.")?;
    let slot = global_slot()?;
    let cancel = Arc::new(AtomicBool::new(false));
    let state = Arc::new(Mutex::new(
        json!({"status":"running","bytes":0,"files":0,"message":"Transferring files…","result":null}),
    ));
    let control = Control {
        cancel: cancel.clone(),
        source_released: source.released.clone(),
        destination_released: destination.released.clone(),
        permission: p.cancellation.subscribe(),
        state: state.clone(),
    };
    let from = source.directory.clone();
    let to = destination.directory.clone();
    let id = uuid::Uuid::new_v4().to_string();
    p.transfers.insert(
        id.clone(),
        TransferJob {
            cancel,
            state: state.clone(),
        },
    );
    super::super::tree_drafts::record_transfer(
        p,
        params["destinationDirectory"].as_str().unwrap(),
        &state,
    );
    tokio::task::spawn_blocking(move || {
        let (_local_slot, _slot) = (local_slot, slot);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let data = super::super::capability_worker::run_with_progress(
                &lease,
                json!({"entry":encode_name(&name), "moving":moving,"rename":rename_conflict}),
                &[from.as_raw_fd(), to.as_raw_fd()],
                &[(from.as_raw_fd(), moving), (to.as_raw_fd(), true)],
                || control.check().is_err(),
                |value| {
                    if let Ok(mut state) = control.state.lock() {
                        for key in ["bytes", "files"] {
                            state[key] = value[key].clone();
                        }
                    }
                },
            )?;
            apply_result(&control, data)
        }))
        .unwrap_or_else(|_| Err("The native transfer worker stopped unexpectedly.".into()));
        if let Ok(mut state) = state.lock() {
            match result {
                Ok(_) => {
                    state["status"] = json!("completed");
                    state["message"] = json!("Transfer complete.");
                }
                Err(error) => {
                    state["status"] = json!(if control.check().is_err() {
                        "cancelled"
                    } else {
                        "failed"
                    });
                    state["message"] = json!(error.chars().take(2048).collect::<String>());
                }
            }
        }
    });
    Ok(json!({"jobId":id}))
}
/// Copy an already authorized file descriptor, including an anonymous peer
/// download, without reopening a source path or using global peer state.
pub(super) fn start_prepared(
    p: &mut PermissionSet,
    params: &Value,
    lease: Arc<super::super::document_processing::ServiceLease>,
) -> Result<Value, String> {
    p.authorize("files.read")?;
    if p.transfers.len() >= 16 {
        return Err("Close an old transfer before starting another.".into());
    }
    let key = |name: &str| {
        params
            .get(name)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 256)
            .ok_or_else(|| format!("Missing {name}."))
    };
    let source_handle = key("sourceHandle")?.to_owned();
    let file = p
        .files
        .get(&source_handle)
        .ok_or("Source file is not granted.")?
        .file
        .try_clone()
        .map_err(failure)?;
    let metadata = file.metadata().map_err(failure)?;
    if !metadata.is_file() {
        return Err("Copy a regular file.".into());
    }
    let destination = p
        .folders
        .get(key("destinationDirectory")?)
        .ok_or("Destination folder is not granted.")?;
    if !destination.writable {
        return Err("Choose the destination for writing.".into());
    }
    let name = decode_name(
        params
            .get("entry")
            .and_then(Value::as_str)
            .ok_or("Choose a source entry.")?,
    )?;
    let conflicts = match params.get("conflict").and_then(Value::as_str) {
        None | Some("error") => false,
        Some("rename") => true,
        _ => return Err("Invalid conflict policy.".into()),
    };
    let slot = p
        .transfer_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Other file transfers are running.")?;
    let global = global_slot()?;
    let cancel = Arc::new(AtomicBool::new(false));
    let state = Arc::new(Mutex::new(
        json!({"status":"running","bytes":0,"files":0,"message":"Copying file…","result":null}),
    ));
    let control = Control {
        cancel: cancel.clone(),
        source_released: cancel.clone(),
        destination_released: destination.released.clone(),
        permission: p.cancellation.subscribe(),
        state: state.clone(),
    };
    let to = destination.directory.clone();
    let id = uuid::Uuid::new_v4().to_string();
    p.archive_reads.insert(
        id.clone(),
        super::super::file_preview::ReadGuard::new(source_handle, cancel.clone()),
    );
    p.transfers.insert(
        id.clone(),
        TransferJob {
            cancel,
            state: state.clone(),
        },
    );
    super::super::tree_drafts::record_transfer(
        p,
        params["destinationDirectory"].as_str().unwrap(),
        &state,
    );
    tokio::task::spawn_blocking(move || {
        let (_slot, _global) = (slot, global);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let data = super::super::capability_worker::run_with_progress(
                &lease,
                json!({"entry":encode_name(&name), "prepared":true,"rename":conflicts}),
                &[file.as_raw_fd(), to.as_raw_fd()],
                &[(file.as_raw_fd(), false), (to.as_raw_fd(), true)],
                || control.check().is_err(),
                |value| {
                    if let Ok(mut state) = control.state.lock() {
                        for key in ["bytes", "files"] {
                            state[key] = value[key].clone();
                        }
                    }
                },
            )?;
            apply_result(&control, data)
        }))
        .unwrap_or_else(|_| Err("The file copy worker stopped unexpectedly.".into()));
        if let Ok(mut state) = state.lock() {
            match result {
                Ok(()) => {
                    state["status"] = json!("completed");
                    state["message"] = json!("Transfer complete.");
                }
                Err(error) => {
                    state["status"] = json!(if control.check().is_err() {
                        "cancelled"
                    } else {
                        "failed"
                    });
                    state["message"] = json!(error.chars().take(2048).collect::<String>());
                }
            }
        }
    });
    Ok(json!({"jobId":id}))
}

fn failure(error: std::io::Error) -> String {
    error.to_string()
}

fn apply_result(control: &Control, data: Value) -> Result<(), String> {
    let mut state = control
        .state
        .lock()
        .map_err(|_| "Transfer status unavailable.")?;
    for key in ["bytes", "files", "result"] {
        state[key] = data[key].clone();
    }
    Ok(())
}
