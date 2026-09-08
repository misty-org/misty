//! Keeps this computer from idling to sleep while an agent works on it
//! (docs/design/agents-on-devices/BRIEF.md). Only idle system sleep is held:
//! the display may still turn off, and closing a laptop lid still sleeps it.

/// Holds or releases the keep-awake assertion. Repeating a call is harmless.
#[tauri::command]
pub fn power_keep_awake(hold: bool) -> Result<(), String> {
    platform::set(hold)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::process::{Child, Command, Stdio};
    use std::sync::Mutex;

    static HOLD: Mutex<Option<Child>> = Mutex::new(None);

    pub fn set(hold: bool) -> Result<(), String> {
        let mut guard = HOLD.lock().map_err(|_| "keep_awake_unavailable")?;
        if hold {
            // A held assertion whose process ended (killed elsewhere) is renewed.
            let alive = guard
                .as_mut()
                .is_some_and(|child| matches!(child.try_wait(), Ok(None)));
            if !alive {
                // -i holds off idle sleep; -w ends it with Misty, so a crash
                // never leaves the computer held awake.
                let child = Command::new("/usr/bin/caffeinate")
                    .args(["-i", "-w", &std::process::id().to_string()])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|error| format!("keep_awake_unavailable: {error}"))?;
                *guard = Some(child);
            }
        } else if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }
}

#[cfg(windows)]
mod platform {
    use std::sync::mpsc::{channel, Sender};
    use std::sync::Mutex;
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    // The execution state belongs to the thread that set it, so one parked
    // thread holds it until its sender is dropped.
    static HOLD: Mutex<Option<Sender<()>>> = Mutex::new(None);

    pub fn set(hold: bool) -> Result<(), String> {
        let mut guard = HOLD.lock().map_err(|_| "keep_awake_unavailable")?;
        if hold {
            if guard.is_none() {
                let (sender, receiver) = channel::<()>();
                std::thread::Builder::new()
                    .name("misty-keep-awake".into())
                    .spawn(move || {
                        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                        let _ = receiver.recv();
                        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
                    })
                    .map_err(|error| format!("keep_awake_unavailable: {error}"))?;
                *guard = Some(sender);
            }
        } else {
            guard.take();
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    pub fn set(_hold: bool) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::platform::set;

    #[test]
    fn holds_and_releases_without_leaking_the_assertion() {
        set(true).unwrap();
        set(true).unwrap();
        set(false).unwrap();
        set(false).unwrap();
    }
}
