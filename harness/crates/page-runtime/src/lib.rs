//! The agent page runtime: the script that runs inside each page an agent works on.
//!
//! It builds accessibility snapshots with refs that survive actions, checks and performs actions
//! by ref, waits for the page without model calls, and reads page text for extraction. A host
//! runs it in a named script world of its own (a `WKContentWorld` on macOS, a script world on
//! WebKitGTK), so page scripts share the DOM with it but can neither read nor forge its refs.
//!
//! The runtime is plain JavaScript in `js/`, tested in jsdom (`tests/` at the repository root).
//! A host prepends [`RUNTIME`] to every call: the first call in a document defines
//! `globalThis.__mistyAgentPageV1`, and later ones find it there.

/// The whole runtime, in load order.
pub const RUNTIME: &str = concat!(
    include_str!("../js/vendor_playwright_roles.js"),
    "\n",
    include_str!("../js/page_core.js"),
    "\n",
    include_str!("../js/page_tree.js"),
    "\n",
    include_str!("../js/page_actions.js"),
    "\n",
    include_str!("../js/page_consequence.js"),
    "\n",
    include_str!("../js/page_read.js"),
    "\n",
    include_str!("../js/page_skills.js"),
    "\n",
    include_str!("../js/page_effects.js"),
    "\n",
    include_str!("../js/page_modal.js"),
    "\n",
    include_str!("../js/page_pointer.js"),
    "\n",
    include_str!("../js/page_verify.js")
);

/// The page-world network counter (`js/page_network.js`), which a host may install at document
/// start in the page's own world so settles wait for the page's fetch and XHR calls. Unlike the
/// runtime it is visible to the page, so a host turns it on deliberately.
pub const NETWORK: &str = include_str!("../js/page_network.js");

pub const DIALOGS: &str = include_str!("../js/page_dialogs.js");

pub const CONSOLE: &str = include_str!("../js/page_console.js");

pub const WEBMCP: &str = include_str!("../js/page_webmcp.js");

pub const PAGE: &str = concat!(
    include_str!("../js/page_dialogs.js"),
    "\n",
    include_str!("../js/page_console.js"),
    "\n",
    include_str!("../js/page_network.js")
);

/// The global the runtime defines in its world.
pub const GLOBAL: &str = "__mistyAgentPageV1";

/// The body of an async function that runs one runtime operation and returns its answer as a
/// JSON string, for a host's "call an async function in this world" API
/// (`callAsyncJavaScript` on macOS).
pub fn call_body(operation: &str, args: &serde_json::Value) -> String {
    let args = serde_json::to_string(args).unwrap_or_else(|_| "{}".into());
    full_body(operation, &format!("const args = {args};"))
}

const fn fnv(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut index = 0;
    while index < bytes.len() {
        hash ^= bytes[index] as u64;
        hash = hash.wrapping_mul(0x100000001b3);
        index += 1;
    }
    hash
}

pub const RUNTIME_VERSION: u64 = fnv(RUNTIME.as_bytes());

pub const MISSING: &str = "__misty_runtime_missing__";

pub fn light_body(operation: &str, invocation: &str) -> String {
    let operation = serde_json::Value::from(operation);
    format!(
        "const installed = globalThis.{GLOBAL};\n\
         if (!installed || installed.version !== \"{RUNTIME_VERSION:x}\") return JSON.stringify(\"{MISSING}\");\n\
         {invocation}\nconst page = installed;\n\
         return JSON.stringify(await page.call({operation}, args));"
    )
}

pub fn full_body(operation: &str, invocation: &str) -> String {
    let operation = serde_json::Value::from(operation);
    format!(
        "{RUNTIME}\nglobalThis.{GLOBAL}.version = \"{RUNTIME_VERSION:x}\";\n\
         {invocation}\nconst page = globalThis.{GLOBAL};\n\
         return JSON.stringify(await page.call({operation}, args));"
    )
}

pub fn missing(answer: &str) -> bool {
    answer.trim() == format!("\"{MISSING}\"")
}

mod batch;
mod host;
#[cfg(target_os = "macos")]
pub mod macos;
mod native;
mod navigation;
mod page_tools;
mod picture;
mod skill;
mod step;
mod steps;
mod storage;
mod view;
mod wait;

pub use batch::{
    after_snapshot, modal_refusal, request_document, run_batch, run_steps, DIALOG_HELD,
};
pub use host::{consequence_label, Approval, PageHost, CONSEQUENCE_KINDS};
pub use native::validate_native_input;
pub use navigation::{landed, mark_document, navigate, still_marked, Go, SNAPSHOT_CHARS};
pub use page_tools::page_tools;
pub use picture::picture;
pub use skill::run_skill;
pub use step::run_step;
pub use steps::{
    form_steps, parse_steps, steps_of, Locator, Step, MAX_FORM_FIELDS, MAX_STEPS, MAX_WAIT_MS,
};
pub use storage::storage;
pub use view::{emulate, fit, snap, Fit};
pub use wait::poll;

pub fn page_error(result: &serde_json::Value, fallback: &str) -> String {
    let message = result["error"].as_str().unwrap_or(fallback);
    match result["errorCode"].as_str() {
        Some("browser_snapshot_stale") => format!("browser_snapshot_stale: {message}"),
        _ => message.to_owned(),
    }
}

pub fn rejected(code: &str, message: impl Into<String>) -> serde_json::Value {
    serde_json::json!({"status": "failure", "attempted": false, "tool_error": {"code": code, "message": message.into()}})
}
