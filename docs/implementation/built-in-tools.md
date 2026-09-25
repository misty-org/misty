# Built-in tools

Misty's tool catalog, per-account installations, separate tool updates, downloadable component hosts, and extension storefront have been retired. Files, Browser, and Space tools compile with the main frontend. Existing `/apps/...` links and persisted workspace entries still pass through the route/tab migrations; user data is not deleted.

`UpdateNotices` checks only the signed Misty desktop release. Workspace warnings use a separate event. Unsaved tab state lives in `features/workspace/unsavedChanges.ts`; the Misty updater still refuses to install while a tab has unsaved changes.

`features/builtin-services` opens host-only native worker lifetimes. It checks the active account/session, cancels on account reset or abort, and closes each instance after completion or failure. It makes no catalog, installation, or app-session requests. Files and resource previews use their built-in PDF and document readers directly.

On macOS, `src-tauri/build.rs` builds the document-processing, file-search, and peer-transport workers for Cargo's target and profile and embeds their bytes in Misty. The native grant registry admits only the known Files/Library service combinations, with read-only file scopes and a device connection scope where needed. Existing native folder/picker grants, process isolation, deployment/account separation, and cancellation remain in force. Workers update with Misty; no caller-provided executable path, downloaded package, or separate signing key is involved. Other platforms retain their existing native implementations.

Catalog build/publish tasks and native install/extension execution entrypoints are removed. The release workflow packages the SDK plus Misty installers and publishes only the Misty update feed. SDK types and built-in tool source remain in the repository; their historical source directories are not installable products.

Validation covers the desktop build, notice behavior, built-in shortcuts, document readers, account cancellation, native scope limits, and an actual embedded worker processing a document without an installed package. Signed release installation and live device pairing require a packaged build and are not covered by these automated checks.

The retirement checks pass: 39 focused frontend tests, 43 build-tool tests, 53 CLI tests, and two native built-in service tests. The full frontend suite remains red (2,153 passed, 89 failed), including legacy route assertions, missing test mocks, and source-size contracts. Those broader failures have not all been established as pre-existing.
