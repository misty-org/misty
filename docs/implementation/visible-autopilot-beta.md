# Visible autopilot beta

Updated 2026-09-22. Status: **Foreground navigation trial passed; broader beta acceptance remains VERIFY**.

## Approved scope

The macOS beta keeps User / Agent / Team visible, with only Agent enabled. The user hands over the foreground Misty window and watches the agent work. Simultaneous desktop work, separate agent desktops and background Team execution are deferred from this beta. Existing non-macOS behavior is not certified by this implementation.

Preserve the normal workspace. The added control bar provides status, Chat, Stop and Resume. A native cursor marks the agent's actual point/scroll target. It currently jumps between targets; smooth cursor travel has not been implemented or visually verified.

## Implemented path

- The host supplies current account/Space, Space name, active window/tab/pane and open app views. The task conversation supplies user intent. Closed navigation history is excluded.
- `browser.workspace.visual` captures the entire foreground Misty window, including its host UI and child webviews. The runtime sends the image to the model as an image, not just text metadata.
- `browser.workspace.interact` accepts bounded image coordinates, text and a limited key set. Native events target Misty's own window. A fresh screenshot is required after each action; an attempted event is not reported as a verified effect.
- Task, account, Space, browser grant, foreground window, snapshot age and window geometry are checked. Stop releases the native lease. A queued native dispatch rechecks authority before acting.
- Existing device jobs, billing limits and consequential-action review are reused. Visible-autopilot requests cannot use hidden server write tools to substitute for UI work.
- Capture uses macOS 14.4+ ScreenCaptureKit's current-process window API. It does not request capture of other applications. Browser must currently be assigned to the agent because the existing device transport is reused.

## Local verification

Environment: isolated `Misty Catalog Pilot.app`, disposable `misty_catalog_pilot` database, local API and runtime. Installed `/Applications/Misty.app` and published releases are unchanged. Host/server working trees contain other uncommitted work; this is not a frozen release revision.

- Native app builds successfully. The native action-bounds unit test passed.
- Host typecheck passed. The latest four focused frontend suites passed 22 tests, covering mode gating, workspace context, startup readiness, Stop dispatch and execution isolation.
- Focused API schema/mode/approval tests and runtime image-transport checks passed during implementation.
- Invocation `invocation_ec3e37c5-b985-4159-895a-1c9e84289455` completed `browser.workspace.visual`. The model selected the visible Journal sidebar coordinates. Its subsequent interaction was rejected before native input because Misty was no longer the foreground window. The device job conservatively records this interaction as uncertain; no successful click is claimed.
- Invocation `invocation_a4b5c6a4-aab4-4093-93d9-0669e88c866e` failed its foreground preflight. Native diagnostics reported: “Misty lost focus to ChatGPT. Bring Misty to the front, then resume.” This identifies an actual competing foreground application, rather than evidence that the model cannot understand the screenshot.
- Fixed startup observation before initialization, multi-webview main-window lookup, and Resume opening an unnecessary chat overlay. These fixes do not constitute end-to-end acceptance.
- **Native navigation passed:** after the user kept Misty foreground, invocation `invocation_2eac0196-f465-4495-badb-e110c42d6b0b` completed exactly `browser.workspace.visual` → `browser.workspace.interact` (point x=0.059, y=0.393) → `browser.workspace.visual`. The user confirmed success. Independent native UI inspection showed the Journal sidebar expanded, the Notes tab and My Notes page at the expected Space's `/notes` route, and “Task finished — you have control.” No note was created by this navigation-only test. This proves the whole-window observation/action/verification loop, not the full catalog workflow.

## Remaining acceptance

1. Navigation is verified above. Separately inspect cursor visibility during a longer run; smooth travel is still unimplemented.
2. Create and read back one disposable Journal note using native point/type actions, then verify persisted content. Verify scroll and an embedded browser view too.
3. Stop an active run and verify no later UI action; test focus loss, window resize, account/Space change and fresh Resume without duplicate writes. Unit tests are not substitutes for this native check.
4. Revalidate the clothing mockup → catalog → Drive journey on this new input path. Earlier browser-only uploads do not prove this path. The catalog PDF remains incomplete.
5. Freeze compatible host/API/runtime versions and complete packaged-install/release checks before calling the beta ready.

The foreground trial succeeded after the user kept Misty in front. No approval, capture permission or focus guard was removed to force it through.

## YouTube follow-up and approval repair

Invocation `invocation_6f1bf465-af77-46ad-9be1-2be49c44d142` captured four usable screenshots, opened Browser, focused the address bar and visibly typed `https://www.youtube.com`. Its next model call requested Enter against the latest screenshot. Enter requires review; protected-review persistence still excluded `browser.workspace.interact`, causing a server error before native dispatch. The later conversational explanation that captures lacked usable images was not supported by the saved evidence. `attempted: true, verified: false` was the normal immediate action result, not this failure's cause.

Added workspace interaction to protected-review persistence, review lookup/presentation and the approval decision's protected-payload requirement. Extended the PostgreSQL contract test through pending review, recovery, approval, exact-action resume and rejection of changed arguments. The test reproduced `invalid space data` before the fix and passed afterward; focused API tests and the server build also passed. The local pilot API was restarted with this repair. A complete native YouTube search and approval UI retry remain unverified.
