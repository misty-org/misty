// SPDX-License-Identifier: MIT
//! Native extension tests: WebKit's real `WKWebExtension` and Misty's production host, driven
//! with MIT-owned fixtures on macOS 15.4 or later. They need a desktop session (they open
//! windows and WebKit's processes), so they only run on request:
//!
//! ```text
//! cargo test --test extension_native -- --ignored                  # all probes
//! cargo test --test extension_native -- --ignored --notifications  # and the notification probe
//! ```
//!
//! The runner starts every probe as its own process (`--probe <name> ...`), as each one owns the
//! main thread's run loop and ends the process with its verdict.
#[cfg(target_os = "macos")]
mod benchmark;
#[cfg(target_os = "macos")]
mod compat;
#[cfg(target_os = "macos")]
mod fixtures;
#[cfg(target_os = "macos")]
mod host;
#[cfg(target_os = "macos")]
mod lifecycle;
#[cfg(target_os = "macos")]
mod messaging;
#[cfg(target_os = "macos")]
mod notifications;
#[cfg(target_os = "macos")]
mod permissions;
#[cfg(target_os = "macos")]
mod probe;
#[cfg(target_os = "macos")]
mod runner;
#[cfg(target_os = "macos")]
mod spaces;
#[cfg(target_os = "macos")]
mod support;

#[cfg(target_os = "macos")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    // The companion program native messaging starts: this binary again, told so by the environment.
    if std::env::var_os("MISTY_NATIVE_FIXTURE_HOST").is_some() && args.len() == 3 {
        messaging::companion();
    }
    match args.iter().position(|arg| arg == "--probe") {
        Some(at) => run_probe(&args[at + 1..]),
        None => runner::run(&args),
    }
}

/// Peak resident memory of this process.
#[cfg(target_os = "macos")]
fn peak_rss_mib() -> f64 {
    // SAFETY: a plain resource-usage query on this process.
    let usage = unsafe {
        let mut usage = std::mem::zeroed::<libc::rusage>();
        libc::getrusage(libc::RUSAGE_SELF, &mut usage);
        usage
    };
    usage.ru_maxrss as f64 / 1_048_576.0
}

#[cfg(target_os = "macos")]
fn run_probe(args: &[String]) {
    let text = |index: usize| {
        args.get(index)
            .map(String::as_str)
            .unwrap_or_else(|| support::fail("missing probe argument"))
    };
    match text(0) {
        "probe" => probe::run(text(1)),
        "host" => host::run(text(1), text(2)),
        "lifecycle" => lifecycle::run(text(1), text(2)),
        "benchmark" => benchmark::run(text(1), text(2).parse().unwrap_or(0)),
        "compat" => compat::run(text(1), text(2)),
        "permissions" => permissions::run(text(1), text(2)),
        "spaces" => spaces::run(text(1), text(2), text(3), &args[4..]),
        "messaging" => messaging::run(text(1)),
        "notifications" => notifications::run(text(1)),
        other => support::fail(format!("unknown probe {other}")),
    }
    std::process::exit(0);
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("SKIP: the native extension tests need macOS");
}
