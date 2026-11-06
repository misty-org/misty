//! Debug builds only, so it can't exist in a release: lets a test ask the real worker, inside its
//! real profile, to do what the profile forbids. A test of the profile alone wouldn't show that this
//! binary is the thing being held to it.
// The point here is to try the plain calls and be refused by the OS, not by the app's file gate.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::{
    fs,
    io::Write,
    net::TcpStream,
    process::{Command, Stdio},
    time::Duration,
};

/// `probe <what> <argument>` answers `ok` or `refused`.
pub(super) fn run(input: &[u8]) -> Option<String> {
    let line = std::str::from_utf8(input).ok()?.strip_prefix("probe ")?;
    let (what, argument) = line.trim().split_once(' ')?;
    let worked = match what {
        "read" => fs::read(argument).is_ok(),
        "list" => fs::read_dir(argument).is_ok(),
        "write" => fs::File::create(argument).and_then(|mut file| file.write_all(b"x")).is_ok(),
        "connect" => argument.parse().ok().is_some_and(|address| TcpStream::connect_timeout(&address, Duration::from_secs(2)).is_ok()),
        "resolve" => std::net::ToSocketAddrs::to_socket_addrs(&(argument, 80)).is_ok(),
        "run" => Command::new(argument).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok(),
        _ => return Some("unknown".to_owned()),
    };
    Some(if worked { "ok" } else { "refused" }.to_owned())
}
