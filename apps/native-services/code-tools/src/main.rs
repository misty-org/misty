use misty_code_tools::{lsp_send_blocking, lsp_stop_blocking, start, stop_all};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{BufRead, Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

const PROTOCOL: u32 = 1;
// An 8 MiB JSON-RPC string can expand sixfold when escaped in the envelope.
const MAX_FRAME: u64 = 48 * 1024 * 1024 + 1024;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    protocol: u32,
    id: u64,
    command: Command,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
enum Command {
    Start { language: String },
    Send { payload: String },
    Stop,
}
struct Cleanup;
impl Drop for Cleanup {
    fn drop(&mut self) {
        stop_all();
    }
}
fn main() {
    let _cleanup = Cleanup;
    if let Err(error) = run() {
        eprintln!("Code service: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), String> {
    let _cleanup = Cleanup;
    let output = Mutex::new(std::io::stdout());
    let emit = Arc::new(move |value: Value| -> Result<(), String> {
        let mut output = output.lock().map_err(|_| "Code output unavailable.")?;
        serde_json::to_writer(&mut *output, &value).map_err(|e| e.to_string())?;
        output
            .write_all(b"\n")
            .and_then(|_| output.flush())
            .map_err(|e| e.to_string())
    });
    let disconnected = Arc::new(AtomicBool::new(false));
    let reader_stop = disconnected.clone();
    let (input, requests) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut stdin = stdin.lock();
        loop {
            let mut line = Vec::new();
            let result = (&mut stdin)
                .take(MAX_FRAME + 1)
                .read_until(b'\n', &mut line);
            if result.is_err() || line.is_empty() || line.len() as u64 > MAX_FRAME {
                break;
            }
            if input.try_send(line).is_err() {
                break;
            }
        }
        reader_stop.store(true, Ordering::Release);
        // Independent of a blocked write to the language server's stdin.
        stop_all();
    });
    let mut session = None;
    for line in requests {
        if disconnected.load(Ordering::Acquire) {
            return Err("Code supervisor disconnected.".into());
        }
        let request: Request =
            serde_json::from_slice(&line).map_err(|_| "Invalid Code request.")?;
        if request.protocol != PROTOCOL {
            return Err("Unsupported Code service protocol.".into());
        }
        let stopping = matches!(request.command, Command::Stop);
        let result = (|| -> Result<Value, String> {
            match request.command {
                Command::Start { language } => {
                    if session.is_some() {
                        return Err("Language server already started.".into());
                    }
                    if language.len() > 32 {
                        return Err("Invalid language.".into());
                    }
                    let messages = emit.clone();
                    let exits = emit.clone();
                    let id = start(
                        &language,
                        move |_, payload| {
                            if messages(
                                json!({"protocol":PROTOCOL,"event":"message","payload":payload}),
                            )
                            .is_err()
                            {
                                stop_all();
                            }
                        },
                        move |_, reason| {
                            let _ =
                                exits(json!({"protocol":PROTOCOL,"event":"exit","reason":reason}));
                        },
                    )?;
                    session = Some(id);
                    if disconnected.load(Ordering::Acquire) {
                        stop_all();
                        return Err("Code supervisor disconnected.".into());
                    }
                    Ok(Value::Null)
                }
                Command::Send { payload } => {
                    lsp_send_blocking(
                        session
                            .as_ref()
                            .ok_or("Language server not started.")?
                            .clone(),
                        payload,
                    )?;
                    Ok(Value::Null)
                }
                Command::Stop => {
                    if let Some(id) = session.take() {
                        lsp_stop_blocking(id)?;
                    }
                    Ok(Value::Null)
                }
            }
        })();
        match result {
            Ok(value) => emit(json!({"protocol":PROTOCOL,"id":request.id,"result":value}))?,
            Err(error) => emit(json!({"protocol":PROTOCOL,"id":request.id,"error":error}))?,
        }
        if stopping {
            break;
        }
    }
    Ok(())
}
