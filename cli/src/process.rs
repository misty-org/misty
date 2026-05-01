use std::{
    collections::BTreeMap,
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
                self.display(),
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
        command
            .args(&self.args)
            .current_dir(directory)
            .envs(&self.environment);
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

    #[test]
    fn display_quotes_arguments_with_spaces() {
        let command = CommandSpec::new("tool").arg("hello world");
        assert_eq!(command.display(), "tool \"hello world\"");
    }
}
