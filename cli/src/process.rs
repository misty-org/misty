use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::{OsStr, OsString},
    path::Path,
    process::{Command, Stdio},
};

use anyhow::{bail, Context, Result};

#[derive(Debug, Default)]
pub struct CommandSpec {
    program: OsString,
    args: Vec<OsString>,
    environment: BTreeMap<OsString, OsString>,
    removed_environment: BTreeSet<OsString>,
}

impl CommandSpec {
    pub fn new(program: impl Into<OsString>) -> Self {
        Self {
            program: program.into(),
            ..Self::default()
        }
    }

    pub fn arg(mut self, argument: impl Into<OsString>) -> Self {
        self.args.push(argument.into());
        self
    }

    pub fn args<I, S>(mut self, arguments: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.args.extend(arguments.into_iter().map(Into::into));
        self
    }

    pub fn env(mut self, name: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.environment.insert(name.into(), value.into());
        self
    }

    pub fn env_remove(mut self, name: impl Into<OsString>) -> Self {
        self.removed_environment.insert(name.into());
        self
    }

    pub fn run(&self, directory: &Path) -> Result<()> {
        eprintln!("> {}", self.display());
        let status = self
            .command(directory)
            .status()
            .with_context(|| format!("could not start {}", self.display()))?;
        if !status.success() {
            bail!("{} exited with {status}", self.display());
        }
        Ok(())
    }

    /// Keep bounded, redacted diagnostics while showing only stage progress.
    pub fn run_logged(&self, directory: &Path, log: &Path, secrets: &[String]) -> Result<()> {
        use std::io::{Read, Write};
        let mut child = self
            .command(directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("could not start subprocess")?;
        fn collect(mut input: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
            std::thread::spawn(move || {
                let mut kept = Vec::new();
                let mut buffer = [0; 8192];
                while let Ok(count) = input.read(&mut buffer) {
                    if count == 0 {
                        break;
                    }
                    kept.extend_from_slice(&buffer[..count]);
                    if kept.len() > 512 * 1024 {
                        kept.drain(..kept.len() - 512 * 1024);
                    }
                }
                kept
            })
        }
        let stdout = collect(child.stdout.take().context("missing stdout")?);
        let stderr = collect(child.stderr.take().context("missing stderr")?);
        let started = std::time::Instant::now();
        let mut next_progress = 15;
        let status = loop {
            if let Some(status) = child.try_wait()? {
                break status;
            }
            if started.elapsed().as_secs() >= next_progress {
                eprintln!(
                    "Still running… {}s (capturing diagnostics)",
                    started.elapsed().as_secs()
                );
                next_progress += 15;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        };
        let mut output = String::from_utf8_lossy(&stdout.join().unwrap_or_default()).into_owned();
        output.push_str(&String::from_utf8_lossy(&stderr.join().unwrap_or_default()));
        let mut ordered = secrets.to_vec();
        ordered.sort_by_key(|value| std::cmp::Reverse(value.len()));
        for secret in ordered.iter().filter(|value| !value.is_empty()) {
            output = output.replace(secret, "[redacted]");
        }
        if let Some(parent) = log.parent() {
            std::fs::create_dir_all(parent)?;
        }
        crate::artifacts::write_private(log, output.as_bytes())?;
        if !status.success() {
            let lines: Vec<_> = output.lines().collect();
            for line in lines.iter().skip(lines.len().saturating_sub(20)) {
                writeln!(std::io::stderr(), "{line}")?;
            }
            bail!("stage failed ({status}); diagnostics: {}", log.display());
        }
        Ok(())
    }

    pub fn capture(&self, directory: &Path) -> Result<String> {
        let output = self
            .command(directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .with_context(|| format!("could not start {}", self.display()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!(
                "{} exited with {}: {}",
                self.program.to_string_lossy(),
                output.status,
                stderr.trim()
            );
        }
        String::from_utf8(output.stdout).context("command output was not UTF-8")
    }

    pub fn display(&self) -> String {
        std::iter::once(self.program.as_os_str())
            .chain(self.args.iter().map(OsString::as_os_str))
            .map(display_argument)
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn command(&self, directory: &Path) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.args).current_dir(directory);
        for name in &self.removed_environment {
            command.env_remove(name);
        }
        command.envs(&self.environment);
        command
    }
}

pub fn npm() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

pub fn command_exists(name: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|directory| {
        let candidate = directory.join(name);
        candidate.is_file()
            || (cfg!(windows) && directory.join(format!("{name}.exe")).is_file())
            || (cfg!(windows) && directory.join(format!("{name}.cmd")).is_file())
    })
}

fn display_argument(value: &OsStr) -> String {
    let value = value.to_string_lossy();
    if value.contains([' ', '"', '\'']) {
        format!("{value:?}")
    } else {
        value.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn failed_process_logs_are_bounded_and_redacted() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("output.log");
        let result = CommandSpec::new("sh")
            .args(["-c", "printf 'private-token\\n' >&2; exit 7"])
            .run_logged(tmp.path(), &path, &["private-token".into()]);
        assert!(result.is_err());
        let log = std::fs::read_to_string(&path).unwrap();
        assert!(!log.contains("private-token"));
        assert!(log.contains("[redacted]"));
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn display_quotes_arguments_with_spaces() {
        let command = CommandSpec::new("tool").arg("hello world");
        assert_eq!(command.display(), "tool \"hello world\"");
    }
}
