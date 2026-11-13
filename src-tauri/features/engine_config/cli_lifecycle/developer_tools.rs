// Git for Hermes Agent's installer, which clones its source with it. On a Mac, `/usr/bin/git` is
// only Apple's stub until Apple's developer tools (the Command Line Tools) are installed: running
// it opens Apple's install dialog, and the installer would stop there by surprise. So Misty checks
// first, without running the stub, and the install dialog offers to install the tools itself with
// `xcode-select --install`. On Linux a missing Git is a blocker the plan names.

use std::path::Path;
use std::time::Duration;

use super::routes::Route;
use super::{support, ProgressReporter};

const XCODE_SELECT: &str = "/usr/bin/xcode-select";
/// The stub macOS ships until the developer tools are installed.
const GIT_STUB: &str = "/usr/bin/git";
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Whether this route runs an installer that needs Git.
fn needs_git(engine: &str, route: Route) -> bool {
    engine == "hermes" && matches!(route, Route::MistyScript | Route::VendorScript)
}

/// Whether the install has to get Apple's developer tools first: Hermes Agent on a Mac whose Git
/// is only the stub.
pub(super) async fn needed(engine: &str, route: Route) -> bool {
    cfg!(target_os = "macos") && needs_git(engine, route) && !mac_git_works().await
}

/// What blocks the install on Linux: no Git at all, which only the system's package manager adds.
pub(super) fn linux_blocker(engine: &str, route: Route) -> Option<String> {
    (cfg!(target_os = "linux")
        && needs_git(engine, route)
        && support::find_program("git").is_none())
    .then(|| {
        "Hermes Agent needs Git. Install it with your system's package manager, then try again."
            .to_string()
    })
}

/// Git that runs: one on the search path that isn't Apple's stub (Homebrew's), or the stub once
/// the developer tools it hands over to are there.
async fn mac_git_works() -> bool {
    match support::find_program("git") {
        None => false,
        Some(git) if git != Path::new(GIT_STUB) => true,
        Some(_) => developer_dir()
            .await
            .is_some_and(|dir| super::is_file_outside_gate(&dir.join("usr/bin/git"))),
    }
}

/// The active developer folder, as `xcode-select -p` prints it. It prints nothing useful and
/// fails when the tools aren't installed, and never opens a dialog.
async fn developer_dir() -> Option<std::path::PathBuf> {
    let mut command = tokio::process::Command::new(XCODE_SELECT);
    command.arg("-p");
    let output = super::run_capture(&mut command, PROBE_TIMEOUT).await.ok()?;
    if !output.status.is_some_and(|status| status.success()) {
        return None;
    }
    let dir = output.stdout.trim();
    (!dir.is_empty()).then(|| dir.into())
}

/// Opens Apple's installer for the developer tools. It runs on its own after this returns; the
/// dialog asks the person to continue once it has finished.
pub(super) async fn open_installer(reporter: &ProgressReporter) -> Result<(), String> {
    reporter.emit("step", Some("engine".into()), None);
    let mut command = tokio::process::Command::new(XCODE_SELECT);
    command.arg("--install");
    let output = super::run_streaming(&mut command, PROBE_TIMEOUT, reporter)
        .await
        .map_err(|error| format!("Couldn't open Apple's installer: {error}"))?;
    if output.status.is_some_and(|status| status.success()) {
        return Ok(());
    }
    let combined = format!("{}\n{}", output.stdout, output.stderr);
    let said = super::tail(&combined, 400);
    Err(if said.is_empty() {
        "Apple's installer didn't open. Try again.".to_string()
    } else {
        format!("Apple's installer didn't open: {said}")
    })
}
