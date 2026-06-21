# Misty Ask — Goal 3 implementation and live verification

**Status: Outlook access restored after user restart; seed message observed in Outlook search results. Full content/thread verification and the live acceptance gate remain outstanding (0 of 8 workflows).**

Resumed September 8, 2026 after the user supplied the Family Space and signed-in Gmail (`mattdev727@gmail.com`), Outlook (`mchen628@gatech.edu`), and Todoist sessions. The earlier prerequisite-only status below is superseded by this section. Credentials remain in the local sessions.

## Latest pilot state

The user explicitly approved “send the test email.” The exact saved Gmail subject, body, sender, and recipient were verified before sending. Gmail displayed **Message sent** and a matching row appeared in Sent; the compose window closed. Evidence: `/tmp/misty-seed-send-result.txt`. An earlier coordinate click did not send; Sent was inspected with no matching message before the successful accessibility button action. No duplicate send was attempted after success.

The seed was sent from `mattdev727@gmail.com` to `mchen628@gatech.edu`, subject **Misty pilot: task and reply (2026-09-08)**, with the exact body below. Outlook opened an account picker; selecting the intended existing account led to Microsoft's Outlook landing page rather than the mailbox. Delivery has therefore **not** been verified. Restore mailbox access to inspect receipt and resume the remaining live matrix. Seed setup does not count as a workflow acceptance test.

## Implemented and verified

- Native macOS context menu leads with **Ask Misty…**, captures a bounded trusted-gesture snapshot, and retains copy/paste and relevant link/image commands. Page content cannot supply Space, account, or device authority. Opening the menu does not submit content to a model.
- Ask receives the originating Space, source URL/revision, and selected content. General or unresolved browser context admits **read-only `browser.inspect`**. For a verified account target, the host attaches the primitives required by available semantic capabilities to the existing run. Consequential commits still require exact review. Native task/reply suggestion wiring is implemented using verified availability receipts and fresh local mail identity, but positive live suggestion acceptance is still unverified. External task-destination selection remains unfinished.
- Restored the shared device-job worker in the desktop shell and enabled SDK execution/device jobs for the pilot backend. The CLI preserves the execution flag when preparing development configuration. Routine features retain their independent gates.
- Fixed a live workflow crash: the pinned Workflow SDK compiled canonical 2020-12 JSON Schemas with a draft-7 validator. A version-checked installation patch now selects the correct validator and registers standard formats, preserving validation in both the compiler source and runtime distribution.
- Added immutable declarations for the shipped Gmail, Outlook, and Todoist browser providers under installed official apps. Admission requires installed permissions and explicit target bindings. This registry is not a live provider certification. The subsequent host binding work below connects observed accounts to explicit versioned targets.
- Confirmed signed-in Gmail and Outlook account identities through provider UI. Todoist shows the signed-in username `kannachi323`; its email identity has not yet been established by the semantic adapter.
- A real Todoist right-click → Ask → model/runtime → leased device inspection → Ask answer completed at 16:31:47–16:31:57 UTC. This proves the read-only execution chain, not task creation or sending.

## Verification evidence

- Runtime: 105 tests across 24 files passed, including five tests against the actual pinned Workflow SDK for both schema dialects, format validation, and rejected invalid input. Typecheck passed; rebuilt Docker runtime executed a live model request.
- Host: 26 focused tests across six files passed for native-menu capture fixtures, semantic snapshots, originating context, conversation Space selection, Ask UI, and device worker. Host typecheck passed.
- Native: seven browser-script tests passed; native check/build passed. The native menu was exercised above a live child webview. Full menu interaction acceptance remains outstanding.
- Backend: capability/browser-action unit tests passed. A disposable database applied all 195 migrations. The existing browser/Planner HTTP fixture gate passed; new official-browser admission tests passed for installation, permissions, binding, origin, and revocation. Fixtures do not count toward the live matrix.
- Account-switch regression: a pending conversation response cannot populate another Misty account's state. All 15 conversation-state/browser-handoff tests passed.

The read-only live run preceded the registry rebuild; Gmail account admission preceded the final revocation fix rebuild. Current running builds after the final restart:

| Component | Image |
| --- | --- |
| API | `sha256:e9837dff615aa48226468902320d5e2e2fe0fb693e9ec316f497fd9160383031` |
| Agent runtime | `sha256:d8a0bafc60431718136a84dcf31458a845fc45a6202ad3259bda1ce6e00df463` |

Both containers were healthy. `https://dev-api.mistysys.com/v1/health` returned 200 at 16:47:44 UTC. Desktop uses the dirty development working trees, not a release artifact; exact final release/build capture remains part of acceptance.

## Remaining work, in order

1. Extend the implemented source-account binding to destination selection and certify real provider action observations. Gmail account admission is live-verified; fixture action selectors alone are insufficient. Outlook/Todoist identity admission and external destination ambiguity still need verification.
2. Verify the implemented native suggestions on controlled real mail. Attach the explicitly resolved external task destination to the existing semantic invocation system, preserving exact-effect approvals and reconciliation.
3. Complete Ask progress, review, and inspectable result links, including partial completion and cancellation. Validate the real task/reply data through the websites.
4. Complete Gmail/Outlook × Planner/Todoist twice, then the required login/account/stale-page/disconnection/interruption/uncertain-write and menu edge cases. Record exact final builds and a short demonstration.

No live task has been created. The approved controlled Gmail seed was sent to `mchen628@gatech.edu`, subject **Misty pilot: task and reply (2026-09-08)**, with this body:

> This is a controlled test between my own accounts. Please create a task titled Review Misty pilot workflow, include a link to this email, and prepare a reply confirming the task is ready for review. No real-world work is requested.

The user approved this exact seed send in chat; Gmail confirmed sending. Seed setup is not a workflow acceptance test. UI automation must bring Misty forward and focus actual native field coordinates; an accessibility click alone did not reliably direct keyboard input into the Gmail editor. Final draft fields were inspected after correction.

## Deferred findings

- Some installed official-app assets still show older link-action labels; synchronize final official packages before UI acceptance.
- Additional provider certification, generic arbitrary website writes, routine work, and production rollout remain excluded.
- No general cleanup of the existing dirty repositories is included.

## September 8 continuation: source-account binding

- Added a host-only account admission bridge. It validates the live host view lease, originating Space, profile, Misty account/session generation, current URL/origin, adapter version, and observed provider email. Temporary native read grants are always revoked. Page content cannot supply those permissions.
- Uses the actual native provider identities (`google`, `microsoft`, `todoist`) separately from semantic adapter identities (`gmail`, `outlook`, `todoist`). Unsupported or unresolved identities retain general read-only Ask with a visible explanation.
- Configures a versioned SDK target through existing trusted server controls, preserves reduced capabilities and caller-app limits, and resolves available actions against installed permissions. It does not auto-restore disabled targets or changed accounts. Source account and identified thread references are carried into Ask.
- A live Gmail check at **17:19:49–17:19:50 UTC** observed `mattdev727@gmail.com`, configured its Family target (HTTP 200), completed three server capability-resolution requests (HTTP 200), and displayed the observed account in Ask. This was account admission only; no semantic email send or task creation was attempted.
- Enabled `MISTY_SDK_PROVIDERS_ENABLED=true` in the private pilot runtime configuration, wired it through Compose, and updated the installed CLI to preserve it. SDK execution and device jobs remain enabled; routine flags remain separate.
- Revocation now creates an immutable target revision before disabling it. A setup request using the prior revision cannot re-enable the target after a concurrent revoke. Repeated revocation is idempotent and old versions remain available for reconciliation.
- Verification: 21 frontend tests across target admission, browser handoff, and Ask UI passed; host typecheck passed. CLI environment tests passed (3). Fresh disposable-database official provider tests passed, including stale-setup rejection and idempotent revocation for Gmail, Outlook, and Todoist, after all 195 migrations. The existing SDK target/profile/control-page regression also passed against a disposable database. The final API rebuild and unchanged runtime are healthy (image identities above).

At the time of this historical continuation, the seed was unsent; the latest pilot state above supersedes that status. Goal 3 remains unfulfilled; the next implementation work is trusted destination selection and applicable native menu actions, followed by real semantic execution and the full acceptance matrix.

## September 8 continuation: native task/reply suggestions

The native menu now offers **Create task…**, **Prepare reply…**, and **Create task and reply…** only when a host-published capability receipt matches the live native profile, scope, originating Space, provider, allowed origin, and freshly observed email account. The gesture must identify a message on the current thread; unrelated controls and editable fields do not receive reply suggestions. Receipts expire after five minutes. The host resolves the originating Space's Planner independently before offering task suggestions. A recognized domain or webpage-provided capability list cannot create a receipt.

Selecting a suggestion pre-fills global Ask and preserves the captured context; it does not submit the prompt. Account admission repeats when Ask opens, and consequential execution still uses the existing review system. Generic browser essentials and **Ask Misty…** remain available without a receipt. Receipt publication is restricted to the main trusted host webview.

Checks: the menu capture/target admission/handoff tests pass (26 combined tests, followed by the expanded 13-test target suite); four native suggestion tests pass; native check and host typecheck pass. The development native process rebuilt and restarted. Positive native suggestion behavior has **not** been verified against a controlled received email, and no acceptance workflow or demonstration is complete. Receipts are currently primed by opening Ask for a verified account; first-use and post-expiry availability behavior must be exercised in live acceptance.

During this historical continuation, the seed awaited review and no message or task was created. The subsequent approved send is recorded in the latest pilot state above.

## Earlier prerequisite repairs (historical)

## Follow-up: Outlook sign-in navigation repair

At the user's request, repaired desktop web routing while the live acceptance prerequisites remain pending. Website redirects may continue in their current native view and cookie store. Popups open as Misty Browser tabs and retain the original native popup/opener and originating website profile; SDK “Open in Misty Browser” actions also preserve that profile. Desktop web links, including legacy system-opener callers, route into Misty without a system-browser fallback. Removed the desktop external-browser preference and updated the relevant action labels.

Provider admission, native provider requests, and automation origin/account checks remain enforced independently of ordinary browsing. Remote pages received no additional Tauri/native permissions. The notification/devtools permission errors shown in the screenshot do not establish a failed OAuth redirect and were not addressed by granting access.

Verification: 92 focused tests passed; final affected Browser/provider tests passed (39 tests, including source-account preservation); 10 native browser unit tests passed; host typecheck and native desktop build passed. The new development binary requires a Misty restart. Real Outlook authentication is not yet verified; the Goal 3 live matrix and its other prerequisites remain outstanding.

## Follow-up: local backend startup repaired

The runtime Docker build failed because `@misty/contracts` points at `../../third-party/misty-contracts`, which the Dockerfile omitted. The Dockerfile now includes that snapshot and materializes the local file dependency inside `node_modules`, so the final image has a resolvable package and its dependencies.

Verified the reproduced Docker failure, successful fixed image build, direct contracts import in the finished image, and successful `misty server up --detach`. API and runtime containers became healthy; local API/runtime health checks and development `/health` and `/v1/health` checks returned HTTP 200. The migration version is now `20270131000000`.

A private pre-startup database backup was taken at `/var/folders/hd/3cy894z92v70m7crvhv8rwmr0000gn/T/misty-before-backend-start-87yby5av/database.dump` (temporary local storage). Existing volumes were retained. This resolves the startup blocker; the remaining Goal 3 pilot inputs and full live acceptance are still outstanding.

## September 8: Outlook mailbox continuity repair

Removed `prompt=select_account` from ordinary Outlook opening in the canonical SDK provider catalog and the shared Inbox app. Existing saved forced-picker URLs migrate to the clean personal mailbox address without changing profile IDs, connected accounts, or cookie stores. Synced SDK archives into host/apps and generated host/server catalogs; rebuilt the downloaded Inbox desktop package.

A completed navigation to an exact supported Outlook `/mail` origin now saves that profile's clean mailbox landing address. Auth/SSO and unrelated origins are ignored; message IDs, query parameters, and fragments are never saved. The current browser's initial address stays fixed while the destination is learned, so saving does not reload an open message. Explicit personal/work choices still navigate immediately. Old-view callbacks cannot change another currently selected profile's destination. This routing preference is not authentication evidence or automation permission.

Verification: 86 relevant regression tests across four files passed; host typecheck passed; SDK check passed (95 tests across 30 files), plus isolated packed-consumer validation. Inbox desktop build passed. Live UI loaded the rebuilt provider app, but the current Microsoft flow still shows sign-in in progress; mailbox arrival and persistence across a fresh restart are not yet verified. An existing school profile that still starts on the personal site can be pointed to **More website actions → Outlook website → Work or school Outlook** once, after which its destination is retained. No additional email or task was sent/created in this repair.

## September 8: Outlook still loops after selecting an account

User reproduced a repeated Microsoft account picker, distinct from the marketing-homepage routing issue. The live Outlook profile was observed as Personal and explicitly switched to Work or school through the host menu; the menu value was read back. Microsoft still presents its signed-in school account picker. Do not report the authentication loop as fixed.

Hardened explicit mailbox selection against a late completed page event from the prior personal site overwriting the saved work choice. Focused Outlook tests and host typecheck pass. The broader ProviderWorkspace test file now has five failures involving integration-directory/icon expectations after concurrent workspace changes; those unrelated failures were not changed. Prior 86-test regression predates those concurrent changes.

Fixed the observed development Inbox 404 window: official app builds now stage output and publish complete replacement files with the entry point last, keeping previous output and hashed assets available. A failure-preservation test passes, and 40 live HTTP reads spanning an Inbox rebuild all returned 200. Inbox rebuilt successfully. This repairs package availability, not Microsoft authentication.

Current authentication diagnosis: the screenshot errors concern remote Tauri notification/devtools denial and a Microsoft source map, not a demonstrated failed Misty mail API call. The provider website sign-in uses Microsoft's website navigation. A possible interference is `browser_scripts.rs` changing top-level `window.location` to `misty-focus:` on every trusted pointerdown. This is a hypothesis, not an established cause. Asked user to select the account using Tab/Enter rather than clicking to discriminate that path; response pending. Do not widen native permissions on sign-in origins. `reveal_main_window` also takes WebviewWindow and reports failure in the multi-webview host; that separate chrome error remains deferred.

## September 8: Goal 3 resumed after Outlook restart

User confirmed that restarting the entire app resolved the account-picker loop and asked to resume Goal 3. The pointerdown/navigation hypothesis was not established as the cause and was not implemented. Do not reopen that investigation without a new failure.

Confirmed the Family Space and healthy pilot API/runtime. Searched the actual signed-in Outlook mailbox for the exact controlled seed subject; a single matching message from Matthew Chen is visible in All folders results, marked Inbox, 11:02 AM. Evidence: `/tmp/misty-goal3-outlook-search.png`. Full message body, recipient details, and source/thread identifiers have not yet been inspected; the workflow matrix remains 0/8.

Before the result could be opened, the live app changed to an unrelated Connected storage/Add Remote dialog with new Discover/Explorer tabs. Paused live interaction and asked the user to leave Outlook available and pause other UI-controlling tasks. No task or additional email was created. Next step: open the received seed, verify its sender/body/thread, capture native Ask context, and run Outlook → Family Planner task + prepared reply through the existing semantic path.

## September 8: custom browser context menu

The user manually confirmed that Outlook's right-click action opens Ask with attached content. The screenshot still reports unresolved Outlook account identity; it does not prove semantic execution. The previous automated mouse/layering diagnosis was inconclusive and is not recorded as a verified product defect. The user is taking over live UI verification.

At the user's request, the browser context menu now uses the same shared dropdown components, compact 250px layout, icon column, theme, keyboard navigation, and collision handling as File Explorer. This supersedes the original native-menu rendering choice. Native code still creates and retains the bounded context, publishes only a menu key, normalized anchor, and admitted action identifiers, and validates the exact key, expiry, current view/scope/profile/Space/URL, and action allowlist before dispatch. Page content is not included in the presentation event. The host raises its existing overlay layer before mounting the menu, then releases it and restores source focus on dismissal. Selection remains single-use; copy/cut/paste run against the source native view.

Verification: 10 focused frontend tests passed (including trusted capture, keyboard/Escape, once-only dispatch, and overlay cleanup); six native menu tests passed (including stale keys, expiry, rejected unoffered actions, and contextual browser commands). Full frontend typechecking was blocked by an unrelated `DownloadedAppNavigator.test.tsx:113` mock returning a string where `WorkspaceTab` is required. Live appearance, placement above provider views, focus restoration, and clipboard behavior still require the user's manual check on the new native build. No workflow acceptance count changed (0/8).

### Custom-menu focus permission correction

The user's first manual check found `webview.set_webview_focus not allowed`: the new menu called `getCurrentWebview().setFocus()` but the host capability only granted window focus. Added `core:webview:allow-set-webview-focus` to the existing local `main` webview capability; no remote origins or provider views were added. A regression now checks this capability boundary, and a UI test verifies that focus failure dismisses the native menu, releases suspension, and permits a subsequent successful open. All six menu tests passed. The generated desktop capability manifest resolves the focus grant for `main` only. The earlier mocked-focus tests did not catch the missing native permission; live menu verification remains pending.

### Default WebKit menu suppression

The user reported intermittent fallback to WebKit's original menu. Added a macOS document-start plugin guard on all webviews and frames, independent of semantic capture. Browser pages/frames cancel the native default during capture; the host cancels it during bubbling so Radix/File Explorer handlers can run before `defaultPrevented` is set. Events continue propagating to custom handlers. The trusted browser capture handler also cancels immediately before inspecting content, so capture failures cannot restore the default. No new native permissions or webpage bridge were introduced. Seventeen focused tests passed, including frame suppression, website stop-propagation, preserved shell custom menus, ordinary input, capture, and menu dispatch. The user retains live UI verification ownership.

### Browser input ownership recovery

The user reported Outlook becoming unclickable after the context-menu/account checks. A live native hierarchy inspection showed the visible Outlook child below the host; a bounded host inspection reported `overlay: false` and no open menu/dialog. Added explicit native overlay-state reconciliation after the bridge reads current DOM overlays and whenever the host regains focus. It preserves registered overlay reasons and resets an abandoned pointer gesture. Pointer moves with `buttons === 0` and lost pointer capture now release an orphaned pointer-down state. This addresses native state surviving host reloads and pointer-up events landing outside the host. Twenty-five focused browser-runtime/menu tests passed, including idle reconciliation and preservation of genuine overlays. Live pointer behavior remains for user verification; Outlook account identity detection remains unresolved.
