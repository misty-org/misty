# Clothing catalog Agent-mode milestone

Goal set 2026-09-22. Status: in progress, no live acceptance yet.

One foreground macOS personal agent must visibly operate an image-generation website, create three clothing mockups from supplied brand references, assemble a short PDF through a supported editor, upload the images and PDF into the selected Google Drive folder, and return verified links. Login takeover and interrupted-upload recovery must work without duplicate effects or false completion.

Preserve the existing UI. The only planned visual addition is an agent cursor driven by real browser actions. Team mode, scheduling, background execution and broad provider/release work are excluded.

## Implementation order

1. Reuse completed task downloads in browser uploads, preserving task/account/agent authority and checking file integrity. Existing browser uploads only consume conversation attachments.
2. Establish image-service access using existing app/browser account controls; choose one service. Google Docs/Drive already have registered website profiles.
3. Verify real interaction support for the image service and catalog editor, including generation waits, image insertion, PDF export and destination verification.
4. Add the minimal native-webview cursor indicator tied to real actions, hidden during human takeover.
5. Run the full native acceptance workflow, including interrupted upload and login takeover. Record actual results and links without private account data.

## Evidence

- Baseline source inspection: mode selector, native execution surface, grants, login takeover, browser interaction tools and task download receipts exist.
- The upload worker fetches server conversation attachments; downloaded files have local receipts only. This is the first implementation gap.
- The canonical readiness ledger and its 2026-09-19 audit do not establish this workflow as complete.

No mock, unit test, or successful build alone closes this milestone.

## Progress, 2026-09-22

Implemented in the host working tree and sibling server source; not deployed:

- `browser.upload` accepts either a conversation attachment or an opaque completed-download ID plus its source scope. The API checks both assigned destinations; queued device validation rechecks the source context, app assignment, device and window. The worker rejects mismatched source/configuration. Native execution checks task/agent ownership and the pinned SHA-256 before reading bytes. Supported reusable outputs: PNG, JPEG, WebP and PDF, up to 10 MB each.
- Pausing still revokes execution. Explicit resume rotates the task ID and carries only completed verified files forward when the same account/agent/Space/window rebinds the original scope. A new task does not inherit those files.
- Assigning the existing Browser app now creates a general agent browser workspace using its normal account/deployment profile. Provider-specific views retain their own domain policies.
- A small blue cursor follows actual click/type/interaction/upload targets. It does not intercept input, invent idle activity or alter the host layout. Human takeover hides it; reduced motion removes travel.
- Native testing exposed and fixed an existing macOS download defect: Wry supplies `path=None` on successful WKDownload completion. Misty now resolves the unique destination it recorded at download start and checks the file. Ambiguous concurrent downloads are not guessed.
- Live pilot testing exposed a final-accounting failure: a permanent AI allowance error could reject completion while leaving the native task active. Completion now records an explicit failed invocation and acknowledges the callback when the allowance is exhausted. Temporary accounting errors remain retryable. This does not waive billing or report successful completion.

### Verified evidence

- `MISTY_SDK_PROBE_AGENT_FILES=1 MISTY_SDK_PROBE_TIMEOUT_SECONDS=120 node cli/tasks/sdk-package-probe-run.ts browser ./apps`: PASS in real macOS WKWebViews with disposable profiles and loopback fixture pages. PNG and PDF blob downloads completed; a pause revoked access; resume acquired fresh authority; both files uploaded into another webview and the page observed matching SHA-256 hashes. Log: `/tmp/misty-agent-files-probe.log`.
- Native browser tests: 24 passed, including missing-path completion, ambiguous completion rejection, changed files, other agents/tasks, incomplete downloads, symlinks, oversize files and resume ownership. Log: `/tmp/misty-agent-browser-tests.log`.
- Browser script/cursor tests: 10 passed. Cursor screenshot captured from native WebKit: [agent-files-cursor.jpg](../verification/artifacts/agent-files-cursor.jpg). The screenshot is a synthetic transfer fixture, not a real catalog.
- Host typecheck passed. Focused local execution/worker tests: 3 files, 21 tests passed.
- Server `go test ./internal/platform/httpapi ./internal/platform/postgres -run 'TestBrowser|TestNativeAgent|Test.*Device' -count=1`: HTTP tests passed; the Postgres package compiled but reported **no matching tests**. This does not verify the new SQL against a live DB.
- Subsequent real PostgreSQL verification: all 206 current migrations applied to a disposable PostgreSQL 16 container, separate from the running development database. `TestNativeDownloadUploadAuthority` passed all nine contract cases through the production queue/claim/begin/renew path: valid upload and idempotent completion, revoked source/destination assignment, expired source, wrong window/device, missing source capability, unattached source, and source revocation after execution begins. Existing device-execution/native-agent contract tests also passed. This verifies server authority, not a live Drive upload.
- Isolated native pilot opened with current host source, current Go API, current Workflow runtime, a disposable account and Space. Native UI sign-in, Browser installation via local preview, app assignment and Agent-mode activation were observed. **Live model-to-native browser smoke test passed:** the user-style prompt to open `https://example.com`, inspect it and report its heading produced completed `browser.navigate` and `browser.inspect` device jobs; the latter returned the actual page URL, title, text and element references. The agent's visible answer was “The page heading is ‘Example Domain.’” Published Browser package fetch returned HTTP 403; local preview is development evidence only. A fresh account with no Space cannot acquire an execution lease, so the pilot uses a real disposable Space.
- A subsequent real agent task navigated to ChatGPT and inspected its signed-out page, including “Create image. Log in to use.” No images were generated. A clean run preserved the native page and the existing Stop control made it available for human input. Earlier workspace disappearance coincided with development reloads (confirmed by WebKit console); it is not accepted evidence of a production takeover defect. No credentials or CAPTCHA were entered.
- `TestRuntimeCompletionLimitTerminatesInvocation`: three PostgreSQL-backed HTTP contract cases passed for successful/incomplete work hitting a final accounting limit and a transient accounting failure. Terminal failure is committed exactly once across a repeated callback, including a cold invocation hub. The new accounting fix is not yet reverified through a live native model run.
- Follow-up native run against the rebuilt pilot API completed successfully (`invocation_c02c79d4-de4f-4933-925f-701b1a815af4`). With no source/document edits during the run, the existing workspace showed “Task finished — review the result,” retained Agent mode, and kept the page visible. A human-control click on “Learn more” then navigated to IANA's Example Domains page, confirming input was released. This run did not reproduce allowance exhaustion; it verifies normal completion and takeover only.

### Local pilot harness

- PostgreSQL container `misty-agent-workflow-test` on loopback port 55439 uses tmpfs. `misty_agent_workflow_test` is exclusively for destructive contract tests; `misty_catalog_pilot` is a separate database for the interactive pilot.
- Private ephemeral service configuration/launcher: `/tmp/misty-catalog-pilot`. API on 18081, Workflow runtime on 13030, Vite on 5173. Device jobs must be enabled with `MISTY_DEVICE_JOBS_ENABLED=true`. Only the existing AI Gateway credential is reused; service-signing secrets are disposable, and email/storage integrations are not connected.
- Host API override must set `MISTY_PUBLIC_API_URL`; setting only `VITE_MISTY_PUBLIC_API_URL` leaves the repository's `MISTY_PUBLIC_API_URL` taking precedence. Local app preview uses `MISTY_APPS_DIRECTORY` pointed at this checkout's `apps` directory.
- Native pilot bundle: `src-tauri/target/debug/bundle/macos/Misty Catalog Pilot.app`, identifier `com.misty.desktop.catalog-pilot`. The current bundle contains the development native binary and requires the local Vite server. Installed `/Applications/Misty.app` is unchanged.
- Logs: `/tmp/misty-catalog-api.log`, `/tmp/misty-catalog-runtime.log`, `/tmp/misty-catalog-vite.log`. Runtime source build and standalone host debug bundle build passed; updater artifact signing is excluded from this local pilot.

### Next work / remaining acceptance

1. The isolated pilot runs the rebuilt API, current Workflow runtime and development host. The installed Misty app still uses Hosted and does not contain these source changes. Do not confuse pilot evidence with deployed behavior.
2. The matching native/backend/runtime pilot and real browser navigation/inspection now pass. Continue with actual image-site interaction and file actions; the smoke test is not catalog acceptance.
3. User signed in; both ChatGPT and Google Drive are now visibly authenticated in the native pilot. Proceeding with a disclosed fictional NORTHLINE test brand and a new private `Misty catalog test 2026-09-22` folder. No private brand references have been supplied; this tests a fictional brief, not uploaded user artwork.
4. Verify the real image website and catalog editor interactions, generation waits, reference uploads, three actual mockups and PDF export. Google Docs' iframe/canvas editing may need interaction support; no supported editor is certified yet.
5. Complete the real Drive upload, destination verification and interrupted-upload reconciliation. The fixture's pause/resume check is not evidence of a real interrupted Drive upload.

The goal remains active. No readiness ledger row has been marked PASS on this evidence.

### Signed-in pilot follow-up

- ChatGPT and Drive sign-in verified through the native UI after the user completed login.
- First real creation attempt reached the composer but filled its hidden backing textarea. Inspection now omits hidden ordinary controls, retaining hidden file inputs for the dedicated upload operation. Rich contenteditable fill now uses a browser editing transaction instead of direct DOM replacement, restores the human-input lock even on errors, and checks retained text. Nine focused browser interaction tests pass; native site retest pending.
- The disposable pilot account exhausted its Basic local allowance. Only its isolated `misty_catalog_pilot` license was changed to the existing Max tier for testing; normal wallet reconciliation retains prior usage. No production license or vendor limit was changed.
- Native retest passed: the agent filled the visible ChatGPT composer, retained the full prompt, and submitted through the reviewed Send control. ChatGPT produced the ivory NORTHLINE T-shirt mockup in https://chatgpt.com/c/6ab29607-6268-83e8-a693-82d7529b14f0. No successful download, catalog, or Drive file yet.
- Image controls lacked usable names, causing the agent to explore a response menu instead of the image viewer. Inspection now uses accessibility label references and image alt text, skipping whitespace-only labels. Ten focused interaction tests pass. Native download retest pending.
- A browser snapshot becoming stale safely rejected a click, but the runtime terminated that attempt; explicit Resume preserved the existing page. Automatic fresh-inspection recovery remains unverified.
- After a long host suspension the local API, runtime and Vite processes were absent. They were restarted against the existing disposable database; the debug app was restarted after Vite became available. Foreground-only scope remains unchanged.

### Three downloaded mockups and longer foreground runs

- Native Agent actions generated and downloaded all three NORTHLINE PNGs: ivory T-shirt, charcoal hoodie and olive cap. All three local files were visually inspected and have completed, hash-pinned download receipts. No catalog PDF, Drive folder or Drive upload has been completed yet.
- Agent downloads now stage in the app cache; targeting macOS Downloads stalled WebKit's sandbox-extension operation. Normal human downloads retain their existing destination.
- Explicit pre-dispatch stale-snapshot failures now stop the current tool batch and require a fresh browser inspection before planning further actions. Unknown/denied actions and checkpoint failures remain terminal. Go tests, runtime typecheck and focused recovery tests passed; real automatic stale recovery is not yet certified.
- The hard 20-turn cutoff stopped the second image workflow. New foreground personal Agent admissions with a valid native lease now pin a maximum of 120 model turns. Chat, Team, SDK and routines retain 20. Time, billing, approval and device authority remain enforced. Migration 207 preserves existing admitted budgets. PostgreSQL concurrency/replay/authority tests and the new foreground-budget case passed; runtime tests cover completion beyond 20 and stopping at 120. The pilot DB confirms the new allowance; a full 120-turn native run is not yet proven.
- The server's 60-second JSON write deadline also affected the live invocation event stream. Three reconnects exhausted the desktop retry allowance and released the native lease. Invocation SSE now refreshes a bounded 30-second write deadline on each event batch and 15-second heartbeat, and exits on write/flush failure. Two focused tests passed. A subsequent native run stayed connected beyond 60 seconds and delivered its terminal allowance failure normally.
- The isolated Max test wallet was exhausted during repeated development runs. A one-time local test reset was simulated by advancing only that fixture's reset eligibility, retaining consumption ledger entries and reservations. Production billing, tier allowances and vendor limits are unchanged. This is development evidence, not an affordability claim for a production plan.
- Drive's New menu did not open from the agent's click-only event, but opened from a normal native click. Both element and point interactions now dispatch one pointer/mouse down-up-click sequence. Thirteen focused interaction tests passed, including no duplicate click and no retarget after removal. Native rebuild/retest is underway. Reload/restart requires downloading the existing three images again to reacquire authorized receipts; no regeneration is needed.

### Drive folder and upload-menu follow-up

- Native verification passed for the full mouse sequence: the agent opened Drive's New menu, prepared the folder name and created the reviewed private test folder. Drive showed the creation confirmation. The folder is `Misty catalog test 2026-09-22`; do not create another copy.
- Google Drive's folder keyboard handler reads legacy `keyCode`/`which`. Supported synthetic keys now include those values as well as `key`/`code`. The agent successfully opened the existing folder after the fix. Its observed URL is https://drive.google.com/drive/folders/1dSuxWK6epHDgm-Hi-Is4gtl2GQKJx6b3 . No image has been uploaded there yet.
- The three existing images were downloaded again after the native rebuild, and their hashes match the original generated files. A native run continued beyond 20 model turns with the event stream connected for more than three minutes. This validates the extended foreground run and streaming fix, not end-to-end catalog completion.
- Visual inspection replaces the current browser document ID. Approval lookup previously read only text inspections, incorrectly rejecting a point action after a visual inspection. It now selects the newest completed text or visual observation in the same attached browser context. A PostgreSQL contract test covers visual/text ordering, failed observations, context isolation and runtime authority. The rebuilt pilot API allowed the real point action to reach review.
- Opening the review panel collapsed Drive's menu. That point action was not approved against the changed page. Drive's remaining menu items were absent from agent inspection because roving-tabindex menus only give the focused item `tabindex=0`. Inspection now includes visible menuitem/menuitemcheckbox/menuitemradio roles independently of tabindex, and target fingerprints detect a menu becoming hidden. All 17 focused interaction tests and the native build passed. This last fix is built but not loaded or verified in the native pilot.
- The Mac locked before further native testing. Source work and tests continued, but no lock bypass or UI action was attempted afterward. The build triggered a development reload, so prior in-memory download authority must not be assumed valid; the existing images remain cached and can be downloaded from the same conversation again without regeneration.
- Still unverified: uploaded brand references, a supported catalog editor and PDF export, Drive image/PDF uploads and working file links, and interrupted-upload reconciliation without duplicates. The goal remains incomplete; no workflow readiness row is PASS.


### Verified uploads and catalog editor support (2026-09-22, 11:05 local)

- Real native Agent actions uploaded all three NORTHLINE PNGs into the existing private Drive folder, exactly once each. Drive showed three completed uploads and three file rows. The native file-picker guard and exclusive download-receipt upload schema are verified on Drive.
- Paused immediately after the first upload selected its file, before the agent inspected the result. Resume first inspected Drive, retained the existing T-shirt, and uploaded only the missing hoodie and cap. This verifies interruption between selection and verification; it does not simulate a failed network transfer.
- Created one private Google Doc titled NORTHLINE — Catalog Pilot: https://docs.google.com/document/d/1pkZv5WqDOizs_4Jt10RvPuyDI3v9AGJsWaxeOpnM6To/edit . Its body is still blank. Reuse it; do not create another.
- The editor exposes its text control in an accessible same-origin iframe. Native inspection/action support now traverses those frames, pins their document identity, uses their own editing/upload realm, and maps cursor positions to the main viewport. File-picker input guarding also covers existing and newly loaded same-origin frames. Cross-origin frames remain inaccessible. Ten new frame tests, four input-guard tests and 17 existing interaction tests pass. Native build passes; native editor verification remains pending.
- A pinned Workflow runtime transcript test confirms browser.visual image bytes reach the model provider. No screenshot transport defect was established.
- Remaining acceptance: catalog body and illustrations, PDF export/upload, verified individual file links, uploaded brand reference flow, and native automatic stale-inspection recovery. The goal remains incomplete; no workflow ledger PASS. Installed Misty remains unchanged.


### Native editor and recovery verification (2026-09-22, 11:35 local)

- Native frame support is loaded and verified. Agent inspection found Google Docs Document content; the real editing transaction inserted the catalog text. Reloading the document preserved that text.
- Docs consumes its temporary editing buffer. `browser.interact` now reports an accepted transaction as `attempted: true`, `textRetained`, and `websiteEditVerified: false`; it does not mistake the empty buffer for proof of failed insertion or claim the document was saved. A regression test checks that the consumed action cannot be repeated from the same inspection. The stricter draft-preparation contract for `browser.type` is unchanged.
- Point actions now descend through accessible same-origin frames, accounting for frame borders and scale, and dispatch events in the child frame. They refuse inaccessible frames and stop if the frame is removed or its document replaced. Native verification passed: the real Drive picker selected the hoodie, then its Insert control added the image to Docs. Cap and T-shirt were subsequently selected and inserted through the same native tools. The T-shirt was found using its exact filename; a proposed duplicate hoodie selection was denied before dispatch.
- Focused interaction/frame/input-guard checks passed (34 tests); final frame-lifecycle change passed the 30 frame/interaction tests, and the native build passed.
- The first image landed within the introductory sentence. The agent was instructed to repair placement, but no repair has been verified. Three insertions alone are not accepted catalog layout evidence. No PDF download or upload has completed.
- Native automatic stale-inspection recovery is now verified: PDF-menu review closed the menu; the rejected click returned `browser_snapshot_stale`, and the same invocation inspected again and reopened the export menu without user resubmission. A subsequent export required review again, so the menu/review interaction still needs resolution.
- The pilot was closed through the native UI to exit that loop. Reopening reported that the Mac is locked and requires manual unlock. No lock bypass was attempted. The current goal remains incomplete; no workflow ledger row is PASS.

### Real PDF export verified (2026-09-22, 12:26 local)

- Google Docs PDF export now completes in the native Agent workflow. Invocation `c28c33a0-0539-4dca-b2f0-e838054e16e9` produced a finished 6,150,025-byte PDF receipt from the existing NORTHLINE document. The routine inbound download correctly avoids consequential-action review; sending, publishing and access changes retain review.
- The underlying WebKit wrapper treated displayable PDF attachment responses as inline navigation. A native navigation-delegate adapter now honors an exact HTTP `Content-Disposition: attachment` token while retaining the existing download delegate and browser profile. A real native fixture failed before this change and passed afterward. The fixture covers PNG, PDF, popup PDF and HTTP attachment PDF receipts, pause/resume and uploads with matching file hashes. Popup downloads additionally require the exact pending source, live grant and task authority. Temporary diagnostic logging was removed after real-provider verification.
- All five PDF pages were rendered and visually reviewed. The three correct mockups are present exactly once, but their oversized insertion splits an introductory sentence and separates product descriptions. This draft fails catalog layout acceptance and has not been uploaded to Drive.
- The layout attempt exposed ineffective scrolling of the editor's temporary text control. Inspection now exposes scrollable containers, and targeted scrolling uses the closest scrollable ancestor, including the containing page of an accessible frame. Results explicitly report whether scrolling moved. Unrelated panes are never selected as fallback. The 36 focused interaction/frame/input-guard tests pass; native editor retesting remains pending.
- Still required: repair and review catalog layout, save the PDF beside the three existing Drive PNGs, verify individual links, and validate supplied-reference-image flow. No end-to-end workflow ledger PASS.
