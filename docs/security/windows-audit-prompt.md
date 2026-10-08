# Windows security audit prompt

Run this from the repository root on a Windows machine with Claude Code. The macOS audit
(October 2026) already fixed and tested everything it could on a Mac; this pass covers
Windows and repeats the full audit there.

## Part 1: Goal

Do a very deep scan through our entire codebase and infrastructure including frontend, backend, cli, server, database, billing to get the latest updates. Then, I want you to make security audits across all of our microservices and most importantly, our application as a whole. The goal here is to find and fix any very serious vulnerabilities and leaks. Since our data is a hybrid browser also contains more native features like file managers, it's important that we ensure we aren't allowing script injection, database injections, attacking, or any other common vulnerability. Also, we should make sure that in the event that our central server gets compromised, users data is still safe and recoverable. After you ensured that our app is safe and hard to break through, I want you to try and break through our own app. Then continue fixing any issues until everything is secure and robust. Create a report of all the issues you found, and the fix you made in a table as the final result.

## Part 2: Tauri browser audit

You are an expert Cybersecurity Auditor specializing in Rust and Tauri desktop application security.

I am building a web browser inside Tauri. Because this application will render arbitrary, untrusted remote URLs typed in by users, it breaks the standard Tauri security assumption (which assumes frontend code is 100% trusted).

I need you to perform a strict Security Audit of my codebase to ensure malicious websites cannot compromise the user's local machine via Tauri's native bridge.

Please audit the repository against the following Critical Security Architectures:

1. IPC Isolation & Capabilities Firewall:
- Review the `tauri.conf.json` or `src-tauri/capabilities/` configurations.
- Verify that Tauri native IPC commands (invokes) are strictly restricted by webview label.
- Ensure that ONLY the local, trusted browser UI webview (e.g., tabs, bookmarks bar) has permissions to invoke Rust commands.
- Ensure that dynamically spawned webviews/tabs hosting external URLs have ZERO access to Tauri commands.

2. Context & Data Directory Isolation:
- Check how child webviews/tabs are spawned in the Rust layer (e.g., `WebviewBuilder` or `WindowBuilder`).
- Verify if guest tabs are properly isolated using unique data directory profiles, incognito contexts, or distinct webview partitions so they cannot access each other's cookies, session tokens, or `localStorage`.

3. Preload Script and Webview Sanitization:
- Audit any `initialization_script` or preload scripts being injected into the guest webviews.
- Ensure that the global `__TAURI__` object and any window IPC bindings are completely deleted, blocked, or unavailable inside any webview rendering remote text/HTML.

4. Script & Navigation Controls:
- Check if the code restricts unauthorized top-level navigations or deep-linking protocols within the guest webview tabs.

Deliver your audit in three sections:
1. Critical Vulnerabilities found (code blocks showing what is broken and why).
2. Architectural Risks (high-level structural flaws).
3. Exact Remediation Code (the corrected Rust, JSON, or TS configurations to implement immediately).

## Part 3: Windows context from the macOS audit

### Fix these two open Windows issues

1. **Page messages travel as navigations.** On Windows, the scripts Misty injects into
   website tabs send shortcut, focus and pointer messages by navigating to `misty-shortcut:`,
   `misty-focus:` and `misty-pointer:` URLs, which carry the per-tab host token. A page may be
   able to observe its own navigations, so the token is not reliably secret on Windows. macOS
   already uses a native message channel instead. Move Windows off navigations, for example
   by handling app shortcuts natively with WebView2's `AcceleratorKeyPressed` event. See
   `src-tauri/src/infra/browser_scripts.rs` (`browser_viewport_script`), `browser.rs`
   (`on_navigation` handlers) and `browser_shortcuts.rs`.
2. **Sign-in tokens are a plain file.** On Windows the account session and refresh cookies
   are stored by `src-tauri/vendor/misty-credential-store` as an ordinary file, while macOS
   uses the Keychain. Store them in Windows Credential Manager, as
   `src-tauri/crates/browser-sync/src/secure_store.rs` already does for vault secrets,
   migrating existing files and removing them after a verified write.

### Compile and test first

The macOS audit changed Windows-only code that could not be compiled on a Mac. Before
anything else, build and test the desktop crate on Windows (`cargo check`, `cargo test --lib`
and `cargo clippy` in `src-tauri`) and fix any errors in:

- `src-tauri/src/app/commands.rs`: `open_path_default` now opens files through
  `tauri_plugin_opener::open_path`, and `open_terminal_default` passes the folder as the
  working directory instead of an argument.
- `src-tauri/src/infra/misty.rs`: `open_url_in_system_browser` uses `tauri_plugin_opener::open_url`.
- `src-tauri/src/platform/synced_paths.rs`: `is_local_path` and its Windows-only test cases.

Then check these in the running app on Windows: opening files and folders whose names
contain `&`, `^`, `|` or `;` works normally, website tabs cannot load
`http://asset.localhost/...`, and each browser profile gets its own WebView2 data folder.

### Ground rules

- Work only on local builds and disposable databases (`.githooks/server-tests.sh` starts one).
  Do not touch production or the shared dev database.
- Never print secrets; report which ones to rotate.
- Do not commit or push unless asked.
- The earlier fixes are in the git history of this branch. Review them first and make sure
  none of them regress on Windows.
