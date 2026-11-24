use serde::Serialize;

use super::routes::{self, Route};
use super::{maker_builds, support};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdatePlan {
    pub engine: String,
    pub action: &'static str,
    pub kind: &'static str,
    pub steps: Vec<String>,
    pub needs_helper: bool,
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

pub(super) async fn build(engine: String, bin: &str, installed: bool) -> CliUpdatePlan {
    let route = super::route_for(&engine, bin, installed);
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
            let steps = routes::plan_steps(&engine, route, bin, helper);
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
        needs_helper,
        blockers,
        engine,
        platform: platform_name(),
    }
}
