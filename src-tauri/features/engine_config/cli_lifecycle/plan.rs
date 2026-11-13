// The plan the install dialog shows before anything runs: what will run, step by step, and what
// stands in the way, worked out the way the run works it out, so what it shows is what runs.

use serde::Serialize;

use super::routes::{self, Route};
use super::{developer_tools, maker_builds, support};

/// What the install dialog shows: what will run, step by step, under Show details.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdatePlan {
    pub engine: String,
    /// "install" | "update"
    pub action: &'static str,
    /// "npm" | "native" | "none"
    pub kind: &'static str,
    /// What runs or is downloaded, one line per step.
    pub steps: Vec<String>,
    /// Node.js has to be fetched into Misty's folder first.
    pub needs_helper: bool,
    /// Apple's developer tools have to be installed first; running the plan opens their installer.
    pub needs_developer_tools: bool,
    pub can_run: bool,
    pub blockers: Vec<String>,
    pub platform: &'static str,
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// The plan for `engine`, whose program is at `bin`.
pub(super) async fn build(engine: String, bin: &str, installed: bool) -> CliUpdatePlan {
    let route = super::route_for(&engine, bin, installed);
    let mut needs_developer_tools = false;
    let (steps, needs_helper, blockers) = match route {
        Some(route) => {
            let helper = route == Route::MistyNpm && routes::needs_node();
            let mut blockers = Vec::new();
            if route == Route::MistyDownload
                && !maker_builds::available(&engine, maker_builds::Target::this_computer())
            {
                blockers.push(format!("Misty can't install {engine} on this system."));
            }
            if route == Route::NpmGlobal && support::find_program("npm").is_none() {
                blockers
                    .push("npm isn't on this computer, so this copy can't be updated here.".into());
            }
            blockers.extend(developer_tools::linux_blocker(&engine, route));
            needs_developer_tools = developer_tools::needed(&engine, route).await;
            let steps = if needs_developer_tools {
                vec!["xcode-select --install".to_string()]
            } else {
                routes::plan_steps(&engine, route, bin, helper)
            };
            (steps, helper, blockers)
        }
        None => (
            Vec::new(),
            false,
            vec![format!("Misty can't install or update {engine} for you.")],
        ),
    };
    CliUpdatePlan {
        action: if installed { "update" } else { "install" },
        kind: route.map(Route::kind).unwrap_or("none"),
        can_run: blockers.is_empty(),
        steps,
        needs_helper: needs_helper && !needs_developer_tools,
        needs_developer_tools,
        blockers,
        engine,
        platform: platform_name(),
    }
}
