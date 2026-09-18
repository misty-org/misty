pub mod ssh;
mod utf8;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub pixel_width: Option<u16>,
    pub pixel_height: Option<u16>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub environment: Option<Environment>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Environment {
    Local,
    Ssh {
        connection: ssh::SshConnectionRequest,
    },
}

pub enum Event {
    Output(String),
    Exit(Option<u32>),
}
pub type Events = Arc<dyn Fn(Event) -> bool + Send + Sync>;

struct State {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    closed: AtomicBool,
}
impl State {
    fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        // PTY shells establish a new session. Signal the active foreground job
        // as well as the shell, so closing a worker cannot leave it running.
        #[cfg(unix)]
        if let Ok(master) = self.master.lock() {
            if let Some(group) = master.process_group_leader().filter(|id| *id > 1) {
                unsafe {
                    libc::kill(-group, libc::SIGHUP);
                }
            }
        }
        if let Ok(mut child) = self.child.lock() {
            #[cfg(unix)]
            if let Some(pid) = child.process_id().filter(|id| *id > 1) {
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGHUP);
                }
            }
            let _ = child.kill();
        }
    }
}

pub struct Terminal {
    state: Arc<State>,
}
impl Drop for Terminal {
    fn drop(&mut self) {
        self.state.close();
    }
}
impl Terminal {
    pub fn create(request: CreateRequest, events: Events) -> Result<Self, String> {
        let is_ssh = matches!(request.environment, Some(Environment::Ssh { .. }));
        let mut command = match request.environment.as_ref() {
            Some(Environment::Ssh { connection }) => ssh::ssh_command_for_connection(connection)?,
            _ => {
                #[cfg(not(windows))]
                let shell = std::env::var("SHELL").unwrap_or_else(|_| {
                    if cfg!(target_os = "macos") {
                        "/bin/zsh".into()
                    } else {
                        "/bin/sh".into()
                    }
                });
                #[cfg(windows)]
                let shell = "powershell.exe".to_owned();
                let mut command = CommandBuilder::new(shell);
                #[cfg(not(windows))]
                command.arg("-il");
                #[cfg(windows)]
                command.arg("-NoLogo");
                if let Some(cwd) = request
                    .cwd
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                {
                    let path = PathBuf::from(cwd);
                    if path.is_dir() {
                        command.cwd(path);
                    }
                }
                command
            }
        };
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env(
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into()),
        );
        if !is_ssh {
            for (key, value) in request.env {
                if !key.is_empty() {
                    command.env(key, value);
                }
            }
        }
        Self::spawn(
            command,
            size(
                request.cols.unwrap_or(100),
                request.rows.unwrap_or(30),
                request.pixel_width,
                request.pixel_height,
            ),
            events,
        )
    }
    fn spawn(command: CommandBuilder, size: PtySize, events: Events) -> Result<Self, String> {
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| e.to_string())?;
        let state = Arc::new(State {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            closed: AtomicBool::new(false),
        });
        let process = state.clone();
        thread::spawn(move || {
            let mut buffer = [0; 32 * 1024];
            let mut carry = Vec::new();
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let mut bytes = std::mem::take(&mut carry);
                        bytes.extend_from_slice(&buffer[..n]);
                        let text = utf8::extract_valid_utf8(&bytes, &mut carry);
                        if !text.is_empty() && !events(Event::Output(text)) {
                            process.close();
                            break;
                        }
                    }
                }
            }
            if !carry.is_empty() {
                events(Event::Output(String::from_utf8_lossy(&carry).into_owned()));
            }
            // Poll without holding the child lock across a blocking wait: close
            // must remain able to stop a shell that has closed its output stream.
            let code = loop {
                match process
                    .child
                    .lock()
                    .map_err(|_| ())
                    .and_then(|mut child| child.try_wait().map_err(|_| ()))
                {
                    Ok(Some(status)) => break Some(status.exit_code()),
                    Err(()) => break None,
                    Ok(None) => thread::sleep(Duration::from_millis(20)),
                }
            };
            process.closed.store(true, Ordering::Release);
            events(Event::Exit(code));
        });
        Ok(Self { state })
    }
    pub fn close_handle(&self) -> Arc<dyn Fn() + Send + Sync> {
        let state = Arc::downgrade(&self.state);
        Arc::new(move || {
            if let Some(state) = state.upgrade() {
                state.close();
            }
        })
    }
    pub fn process_id(&self) -> Option<u32> {
        self.state
            .child
            .lock()
            .ok()
            .and_then(|child| child.process_id())
    }
    pub fn write(&self, data: &str) -> Result<(), String> {
        if self.state.closed.load(Ordering::Acquire) {
            return Err("Terminal has exited.".into());
        }
        let mut writer = self
            .state
            .writer
            .lock()
            .map_err(|_| "Terminal input unavailable.")?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| e.to_string())
    }
    pub fn resize(
        &self,
        cols: u16,
        rows: u16,
        pixel_width: Option<u16>,
        pixel_height: Option<u16>,
    ) -> Result<(), String> {
        if self.state.closed.load(Ordering::Acquire) {
            return Err("Terminal has exited.".into());
        }
        self.state
            .master
            .lock()
            .map_err(|_| "Terminal resize unavailable.")?
            .resize(size(cols, rows, pixel_width, pixel_height))
            .map_err(|e| e.to_string())
    }
    pub fn interrupt(&self) -> Result<(), String> {
        self.write("\u{3}")
    }
    pub fn close(&self) {
        self.state.close();
    }
}
fn size(cols: u16, rows: u16, pixel_width: Option<u16>, pixel_height: Option<u16>) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(2),
        pixel_width: pixel_width.unwrap_or(0),
        pixel_height: pixel_height.unwrap_or(0),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};
    fn fixture(script: &str) -> (Terminal, Receiver<Event>) {
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", script]);
        let (send, receive) = channel();
        let terminal = Terminal::spawn(
            command,
            size(80, 24, None, None),
            Arc::new(move |event| send.send(event).is_ok()),
        )
        .unwrap();
        (terminal, receive)
    }
    fn until_output(receiver: &Receiver<Event>, needle: &str) -> String {
        let mut output = String::new();
        let start = std::time::Instant::now();
        while !output.contains(needle) {
            let left = Duration::from_secs(5)
                .checked_sub(start.elapsed())
                .expect("output timed out");
            match receiver.recv_timeout(left).expect("output") {
                Event::Output(text) => output.push_str(&text),
                Event::Exit(_) => panic!("exited before {needle}: {output}"),
            }
        }
        output
    }
    fn exit(receiver: &Receiver<Event>) -> Option<u32> {
        let start = std::time::Instant::now();
        loop {
            match receiver
                .recv_timeout(
                    Duration::from_secs(5)
                        .checked_sub(start.elapsed())
                        .expect("exit timeout"),
                )
                .expect("exit")
            {
                Event::Output(_) => {}
                Event::Exit(code) => return code,
            }
        }
    }
    #[test]
    fn output_stream_preserves_split_unicode_and_exit_status() {
        let (_terminal, receiver) =
            fixture("printf '\\303'; sleep 0.05; printf '\\261\\n'; exit 7");
        let output = until_output(&receiver, "ñ");
        assert!(!output.contains('�'));
        assert_eq!(exit(&receiver), Some(7));
    }
    #[test]
    fn input_resize_interrupt_and_close_keep_working() {
        let (terminal,receiver)=fixture("stty -echo; printf ready; IFS= read -r line; stty size; printf '%s' \"$line\"; printf sleeping; exec sleep 30");
        until_output(&receiver, "ready");
        terminal.resize(90, 35, None, None).unwrap();
        terminal.write("hello\n").unwrap();
        let output = until_output(&receiver, "sleeping");
        assert!(output.contains("35 90"));
        assert!(output.contains("hello"));
        terminal.interrupt().unwrap();
        exit(&receiver);
        assert!(terminal.write("late").is_err());
        let (terminal, receiver) = fixture("printf ready; exec sleep 30");
        until_output(&receiver, "ready");
        drop(terminal);
        exit(&receiver);
    }
    #[test]
    fn lost_output_receiver_stops_the_owned_process() {
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "printf ready; exec sleep 30"]);
        let (send, receive) = channel();
        let terminal = Terminal::spawn(
            command,
            size(80, 24, None, None),
            Arc::new(move |event| match event {
                Event::Output(_) => false,
                Event::Exit(code) => send.send(code).is_ok(),
            }),
        )
        .unwrap();
        receive
            .recv_timeout(Duration::from_secs(5))
            .expect("process should stop when its output is disconnected");
        assert!(terminal.write("late").is_err());
    }
}
