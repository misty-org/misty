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
    include_str!("../js/page_skills.js")
);

/// The global the runtime defines in its world.
pub const GLOBAL: &str = "__mistyAgentPageV1";

/// The body of an async function that runs one runtime operation and returns its answer as a
/// JSON string, for a host's "call an async function in this world" API
/// (`callAsyncJavaScript` on macOS).
pub fn call_body(operation: &str, args: &serde_json::Value) -> String {
    let operation = serde_json::Value::from(operation);
    format!(
        "{RUNTIME}\nconst args = {args}; const page = globalThis.{GLOBAL};\n\
         return JSON.stringify(await page.call({operation}, args));"
    )
}
