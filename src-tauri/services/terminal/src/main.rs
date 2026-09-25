use misty_terminal::{ssh, CreateRequest, Event, Terminal, PROTOCOL_VERSION};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, Read, Write};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

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
    Create {
        request: CreateRequest,
    },
    Write {
        data: String,
    },
    Resize {
        cols: u16,
        rows: u16,
        #[serde(rename = "pixelWidth")]
        pixel_width: Option<u16>,
        #[serde(rename = "pixelHeight")]
        pixel_height: Option<u16>,
    },
    Interrupt,
    Close,
    SshEnvironments,
    SshPreflight {
        connection: ssh::SshConnectionRequest,
    },
    SshTrust {
        request: ssh::SshTrustRequest,
    },
}
fn main() {
    if let Err(error) = run() {
        eprintln!("Terminal service: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), String> {
    let output = Arc::new(Mutex::new(std::io::stdout()));
    let send = move |value: Value| -> Result<(), String> {
        let mut stdout = output.lock().map_err(|_| "Terminal output unavailable.")?;
        serde_json::to_writer(&mut *stdout, &value).map_err(|e| e.to_string())?;
        stdout
            .write_all(b"\n")
            .and_then(|_| stdout.flush())
            .map_err(|e| e.to_string())
    };
    let send = Arc::new(send);
    let mut terminal: Option<Terminal> = None;
    let disconnected = Arc::new(AtomicBool::new(false));
    let close: Arc<Mutex<Option<Arc<dyn Fn() + Send + Sync>>>> = Arc::new(Mutex::new(None));
    let (send_input, receive_input) = std::sync::mpsc::sync_channel(8);
    let stop = disconnected.clone();
    let stop_terminal = close.clone();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut input = stdin.lock();
        loop {
            let mut line = Vec::new();
            let read = (&mut input)
                .take(1024 * 1024 + 1)
                .read_until(b'\n', &mut line);
            if read.is_err() || line.is_empty() {
                break;
            }
            if line.len() > 1024 * 1024 {
                let _ = send_input.try_send(Err("Terminal request exceeds its limit.".to_owned()));
                break;
            }
            // A stalled PTY must not prevent the independent input reader from
            // noticing supervisor EOF and stopping the shell.
            if send_input.try_send(Ok(line)).is_err() {
                break;
            }
        }
        stop.store(true, Ordering::Release);
        if let Ok(close) = stop_terminal.lock() {
            if let Some(close) = close.as_ref() {
                close();
            }
        }
    });
    for line in receive_input {
        let line = line?;
        let request: Request =
            serde_json::from_slice(&line).map_err(|_| "Invalid terminal request.")?;
        if request.protocol != PROTOCOL_VERSION {
            return Err("Unsupported terminal protocol.".into());
        }
        let closing = matches!(request.command, Command::Close);
        let result: Result<Value, String> = (|| match request.command {
            Command::Create { request } => {
                if disconnected.load(Ordering::Acquire) {
                    return Err("Terminal supervisor disconnected.".into());
                }
                if terminal.is_some() {
                    return Err("Terminal already created.".into());
                }
                let send = send.clone();
                terminal = Some(Terminal::create(
                    request,
                    Arc::new(move |event| {
                        let value = match event {
                            Event::Output(data) => {
                                json!({"protocol":PROTOCOL_VERSION,"event":"output","data":data})
                            }
                            Event::Exit(code) => {
                                json!({"protocol":PROTOCOL_VERSION,"event":"exit","exitCode":code})
                            }
                        };
                        send(value).is_ok()
                    }),
                )?);
                *close
                    .lock()
                    .map_err(|_| "Terminal cancellation unavailable.")? =
                    terminal.as_ref().map(Terminal::close_handle);
                if disconnected.load(Ordering::Acquire) {
                    if let Some(terminal) = terminal.as_ref() {
                        terminal.close();
                    }
                    return Err("Terminal supervisor disconnected.".into());
                }
                Ok(json!({"processId":terminal.as_ref().and_then(Terminal::process_id)}))
            }
            Command::Write { data } => terminal
                .as_ref()
                .ok_or("Terminal not created.")?
                .write(&data)
                .map(|_| Value::Null),
            Command::Resize {
                cols,
                rows,
                pixel_width,
                pixel_height,
            } => terminal
                .as_ref()
                .ok_or("Terminal not created.")?
                .resize(cols, rows, pixel_width, pixel_height)
                .map(|_| Value::Null),
            Command::Interrupt => terminal
                .as_ref()
                .ok_or("Terminal not created.")?
                .interrupt()
                .map(|_| Value::Null),
            Command::Close => {
                if let Some(terminal) = terminal.take() {
                    terminal.close();
                }
                Ok(Value::Null)
            }
            Command::SshEnvironments => {
                serde_json::to_value(ssh::discover_ssh_environments()?).map_err(|e| e.to_string())
            }
            Command::SshPreflight { connection } => {
                serde_json::to_value(ssh::ssh_preflight(&connection)?).map_err(|e| e.to_string())
            }
            Command::SshTrust { request } => {
                serde_json::to_value(ssh::trust_ssh_host(&request)?).map_err(|e| e.to_string())
            }
        })();
        send(match result {
            Ok(value) => json!({"protocol":PROTOCOL_VERSION,"id":request.id,"result":value}),
            Err(error) => json!({"protocol":PROTOCOL_VERSION,"id":request.id,"error":error}),
        })?;
        if closing {
            break;
        }
    }
    // EOF (including supervisor termination) drops and stops the owned PTY.
    drop(terminal);
    Ok(())
}
