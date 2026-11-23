fn main() {
    #[cfg(all(target_os = "macos", debug_assertions))]
    dev_responsibility::stand_alone();
    misty_native::run();
}

#[cfg(all(target_os = "macos", debug_assertions))]
mod dev_responsibility {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::time::Duration;

    const MARK: &str = "MISTY_DEV_DISCLAIMED_BY";

    extern "C" {
        fn responsibility_spawnattrs_setdisclaim(
            attrs: *mut libc::posix_spawnattr_t,
            disclaim: libc::c_int,
        ) -> libc::c_int;
    }

    static CHILD: AtomicI32 = AtomicI32::new(0);

    extern "C" fn forward(signal: libc::c_int) {
        let pid = CHILD.load(Ordering::SeqCst);
        if pid > 0 {
            unsafe { libc::kill(pid, signal) };
        }
    }

    fn follow(parent: libc::pid_t) {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            if unsafe { libc::getppid() } != parent {
                eprintln!("Misty: the process that started this copy is gone, so it quits too");
                std::process::exit(0);
            }
        });
    }

    pub fn stand_alone() {
        if let Some(parent) = std::env::var_os(MARK) {
            if let Some(pid) = parent.to_str().and_then(|value| value.parse().ok()) {
                follow(pid);
            }
            return;
        }
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let Ok(path) = CString::new(exe.as_os_str().as_bytes()) else {
            return;
        };
        let Ok(args) = std::env::args_os()
            .map(|arg| CString::new(arg.as_bytes()))
            .collect::<Result<Vec<_>, _>>()
        else {
            return;
        };
        let own = std::process::id();
        let Ok(environment) = std::env::vars_os()
            .map(|(key, value)| {
                let mut entry = key.as_bytes().to_vec();
                entry.push(b'=');
                entry.extend_from_slice(value.as_bytes());
                CString::new(entry)
            })
            .chain(std::iter::once(CString::new(format!("{MARK}={own}"))))
            .collect::<Result<Vec<_>, _>>()
        else {
            return;
        };
        let mut argv: Vec<*mut libc::c_char> =
            args.iter().map(|arg| arg.as_ptr() as *mut _).collect();
        argv.push(std::ptr::null_mut());
        let mut envp: Vec<*mut libc::c_char> = environment
            .iter()
            .map(|entry| entry.as_ptr() as *mut _)
            .collect();
        envp.push(std::ptr::null_mut());

        unsafe {
            let mut attrs: libc::posix_spawnattr_t = std::mem::zeroed();
            if libc::posix_spawnattr_init(&mut attrs) != 0 {
                return;
            }
            if responsibility_spawnattrs_setdisclaim(&mut attrs, 1) != 0 {
                libc::posix_spawnattr_destroy(&mut attrs);
                return;
            }
            let mut pid: libc::pid_t = 0;
            let spawned = libc::posix_spawn(
                &mut pid,
                path.as_ptr(),
                std::ptr::null(),
                &attrs,
                argv.as_ptr(),
                envp.as_ptr(),
            );
            libc::posix_spawnattr_destroy(&mut attrs);
            if spawned != 0 {
                return;
            }
            CHILD.store(pid, Ordering::SeqCst);
            let handler = forward as extern "C" fn(libc::c_int) as libc::sighandler_t;
            for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP, libc::SIGQUIT] {
                libc::signal(signal, handler);
            }
            let mut status = 0;
            loop {
                if libc::waitpid(pid, &mut status, 0) != -1 {
                    break;
                }
                if std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR) {
                    std::process::exit(1);
                }
            }
            let code = if libc::WIFEXITED(status) {
                libc::WEXITSTATUS(status)
            } else if libc::WIFSIGNALED(status) {
                128 + libc::WTERMSIG(status)
            } else {
                1
            };
            if libc::WIFSIGNALED(status) {
                eprintln!("Misty was stopped by signal {}", libc::WTERMSIG(status));
            } else if code == 101 {
                eprintln!(
                    "Misty quit after a panic; the panic is in logs/crash.log in its data folder"
                );
            } else if code != 0 {
                eprintln!("Misty quit with exit code {code}");
            }
            std::process::exit(code);
        }
    }
}
