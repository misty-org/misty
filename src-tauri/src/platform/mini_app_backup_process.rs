//! Restricted Restic process construction. The capability layer selects operations;
//! no executable, environment, endpoint, or command line comes from an App.
#![allow(dead_code)] // Used by repository integration checks until the job API is wired.
use std::{path::Path, process::Command};

#[cfg(target_os = "macos")]
const PROFILE: &str = r#"(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow file-read* (literal (param "TOOL")) (subpath (param "WORK"))
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
  (literal "/") (literal "/dev/null") (literal "/dev/urandom"))
(allow file-write* (subpath (param "WORK")))
(allow network-outbound (remote tcp (param "SERVER")))
(allow sysctl-read)
(allow file-read-metadata)
"#;

pub fn command(
    tool: &Path,
    work: &Path,
    endpoint: &str,
    password: &str,
) -> Result<Command, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (tool, work, endpoint, password);
        Err("Isolated backups are not implemented on this platform yet.".into())
    }
    #[cfg(target_os = "macos")]
    {
        let endpoint_url = url::Url::parse(
            endpoint
                .strip_prefix("rest:")
                .ok_or("Invalid native repository connection.")?,
        )
        .map_err(|_| "Invalid native repository connection.")?;
        if endpoint_url.scheme() != "http"
            || endpoint_url.host_str() != Some("127.0.0.1")
            || endpoint_url.path() != "/"
            || endpoint_url.query().is_some()
            || endpoint_url.fragment().is_some()
            || endpoint_url.username() != "misty"
            || endpoint_url.password().is_none_or(str::is_empty)
        {
            return Err(
                "Backup workers require their private native repository connection.".into(),
            );
        }
        let port = endpoint_url
            .port()
            .ok_or("Missing native repository port.")?;
        if port == 0 {
            return Err("Invalid native repository port.".into());
        }
        let mut command = confined_command(tool, work, port, password)?;
        command.args(["--no-cache", "-r", endpoint, "-o", "rest.connections=2"]);
        Ok(command)
    }
}

#[cfg(target_os = "macos")]
fn confined_command(
    tool: &Path,
    work: &Path,
    port: u16,
    password: &str,
) -> Result<Command, String> {
    use std::os::unix::process::CommandExt;
    let tool = tool.canonicalize().map_err(|_| "Restic is unavailable.")?;
    if let Some(home) = dirs::home_dir() {
        let root = home.join(".misty/plugins");
        if tool.starts_with(&root) || root.canonicalize().is_ok_and(|root| tool.starts_with(root)) {
            return Err("Backups requires a Host-installed Restic executable.".into());
        }
    }
    let work = work
        .canonicalize()
        .map_err(|_| "Backup working directory is unavailable.")?;
    let mut command = Command::new("/usr/bin/sandbox-exec");
    command
        .args(["-p", PROFILE, "-D"])
        .arg(format!("TOOL={}", tool.display()))
        .arg("-D")
        .arg(format!("WORK={}", work.display()))
        .arg("-D")
        .arg(format!("SERVER=localhost:{port}"))
        .arg(tool)
        .current_dir(&work)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &work)
        .env("TMPDIR", &work)
        .env("LANG", "C")
        .env("RESTIC_PASSWORD", password)
        .env("GOMAXPROCS", "2")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    command.process_group(0);
    unsafe {
        command.pre_exec(|| {
            for (resource, value) in [
                (libc::RLIMIT_CPU, 86_400),
                (libc::RLIMIT_NOFILE, 128),
                (libc::RLIMIT_CORE, 0),
            ] {
                let limit = libc::rlimit {
                    rlim_cur: value,
                    rlim_max: value,
                };
                if libc::setrlimit(resource, &limit) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    Ok(command)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        process::Stdio,
    };
    #[test]
    fn sandbox_allows_only_the_repository_port_and_no_ambient_file_access_or_exec() {
        let work = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let started = std::time::Instant::now();
            loop {
                match listener.accept() {
                    Ok((mut connection, _)) => {
                        connection
                            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                            .unwrap();
                        let mut request = [0u8; 4096];
                        let _ = connection.read(&mut request);
                        connection.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").unwrap();
                        return;
                    }
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            && started.elapsed().as_secs() < 5 =>
                    {
                        std::thread::sleep(std::time::Duration::from_millis(10))
                    }
                    Err(e) => panic!("Allowed repository port was not reached: {e}"),
                }
            }
        });
        let connect = |target: u16| {
            let mut child =
                confined_command(Path::new("/usr/bin/nc"), work.path(), port, "fixture-only")
                    .unwrap()
                    .args(["-w", "2", "-G", "2", "127.0.0.1"])
                    .arg(target.to_string())
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .unwrap();
            let _ = child
                .stdin
                .take()
                .unwrap()
                .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
            child.wait_with_output().unwrap()
        };
        let allowed = connect(port);
        assert!(
            allowed.status.success(),
            "{}",
            String::from_utf8_lossy(&allowed.stderr)
        );
        assert!(allowed.stdout.ends_with(b"ok"));
        server.join().unwrap();
        let denied_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        denied_listener.set_nonblocking(true).unwrap();
        assert!(!connect(denied_listener.local_addr().unwrap().port())
            .status
            .success());
        assert_eq!(
            denied_listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        let private = outside.path().join("private");
        std::fs::write(&private, b"not-granted").unwrap();
        assert!(
            !confined_command(Path::new("/bin/cat"), work.path(), port, "fixture-only")
                .unwrap()
                .arg(&private)
                .status()
                .unwrap()
                .success()
        );
        let output = outside.path().join("must-not-write");
        let status = confined_command(Path::new("/bin/sh"), work.path(), port, "fixture-only")
            .unwrap()
            .args(["-c", "printf escaped > \"$1\"", "probe"])
            .arg(&output)
            .status()
            .unwrap();
        assert!(!status.success());
        assert!(!output.exists());
        assert!(
            !confined_command(Path::new("/bin/sh"), work.path(), port, "fixture-only")
                .unwrap()
                .args(["-c", "exec /usr/bin/true"])
                .status()
                .unwrap()
                .success()
        );
        let env = confined_command(Path::new("/usr/bin/env"), work.path(), port, "fixture-only")
            .unwrap()
            .stdout(Stdio::piped())
            .output()
            .unwrap();
        assert!(env.status.success());
        let names: std::collections::BTreeSet<_> = String::from_utf8(env.stdout)
            .unwrap()
            .lines()
            .map(|line| line.split('=').next().unwrap().to_owned())
            .collect();
        assert_eq!(
            names,
            [
                "GOMAXPROCS",
                "HOME",
                "LANG",
                "PATH",
                "RESTIC_PASSWORD",
                "TMPDIR"
            ]
            .into_iter()
            .map(str::to_owned)
            .collect()
        );
    }
    #[test]
    fn worker_rejects_non_native_repository_addresses() {
        let work = tempfile::tempdir().unwrap();
        for endpoint in [
            "rest:https://misty:secret@127.0.0.1:1234/",
            "rest:http://misty:secret@example.com:1234/",
            "rest:http://misty:secret@127.0.0.1:1234/other",
            "rest:http://127.0.0.1:1234/",
            "local:/tmp/repo",
        ] {
            assert!(
                command(Path::new("/usr/bin/true"), work.path(), endpoint, "secret").is_err(),
                "{endpoint}"
            );
        }
    }
}
