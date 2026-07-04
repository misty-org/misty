# Cursor companion implementation and acceptance

Updated 2026-09-24. The replacement is implemented in TypeScript/Rust and connected to Misty's existing server invocation and audio endpoints. **Desktop parity is not yet accepted:** a successful build or renderer fixture is not proof of OS behavior.

## Using it

With the updated server and agent runtime deployed, in a newly built, signed-in Misty desktop app on macOS or Windows, the existing animated Misty cloud follows the cursor. Open **Agents** for the inline Companion controls: cursor visibility, Team/Auto, Voice & model, status, Retry and Stop. The tray entry and separate controls window have been removed. Hold **Control + Option** on macOS or **Control + Alt** on Windows, speak, and release. Press again to interrupt.

Team is the default. It answers and points; explicit handoffs use the existing Agents tools. Auto carries the requested task through multiple steps in normal Misty tabs. Complete voice commands such as “switch to auto mode” change modes; questions about modes do not. Hiding the companion preserves temporary visibility for recording, speech and pointing. OS microphone, screen-recording and input-monitoring requirements still apply.

Provider credentials stay on the server. The overlay loads a separate presentation entry point. Native generation/account fences discard late recordings and captures; logout clears overlay and control state. Browser actions use account-bound leases targeting ordinary tabs and do not close those tabs on completion. The original Agents workers remain available for their existing uses.

## Source comparison

Authority: `vendor/clicky/leanring-buddy/OverlayWindow.swift`, `BuddyDictationManager.swift`, and `DesignSystem.swift`; attribution is in `docs/third-party/clicky.md`.

| Behavior | Port |
| --- | --- |
| Cursor following | Offset 35/25; response .2, damping .6 spring |
| Flight | Distance / 800, clamped .6–1.4 seconds; smoothstep quadratic arc, maximum lift 80; tangent rotation and 1.3 scale pulse |
| Pointing | Screenshot-pixel coordinates, labeled displays, native origins/DPI; source phrases typed at 30–60ms, three-second hold after typing, .5-second fade, return to cursor |
| Recording | RMS gain 10.2 and decay .72; five source-profile blue bars with nonlinear response and idle pulse at 36Hz |
| Processing | 70% gradient arc, 2.5px rounded stroke, .8-second rotation |
| Bubble | Source blue, white 11px medium text, 8/4 padding, 6px corners, .4/.6 spring and scale-dependent glow |
| Screen context | Every connected display; cursor display labeled primary; longest image edge 1280, JPEG quality 80; companion surfaces hidden during capture |
| Conversation | Last ten completed exchanges, source conversational style with Misty branding, OpenAI server providers, pixel POINT tags stripped from speech |

The existing WebP is the sole character asset. Email collection, analytics, promotional assets and external provider branding were not ported. The former sidebar, collapsed rail, injected pointer and companion-specific worker tracking were removed. Account-owned history, existing Agents workers and unrelated sync changes were retained. Recovery expansion is outside this replacement.

## Agents-page correction (2026-09-24)

The companion's controls and live state now live inside Agents, shared with the native voice controller. Typed requests carry the same Team/Auto mode and use normal-tab execution. Both obsolete User/Agent/Team selectors have been removed from the conversation and settings. Native startup errors appear inline with Retry. Mode changes interrupt ongoing typed or spoken execution before applying.

The overlay has its own `companion.html` entry point and derives its display from the native window label. Legacy query-based overlay windows remain isolated during frontend hot reload; the obsolete controls window tells users to restart and use Agents rather than silently mounting the full app. Original animated and reduced-motion WebPs are embedded by Vite (`?inline`) without changing their bytes, removing separate asset URL requests in both development and packaged builds.

Verified in the packaged macOS app: visible cloud sprites, inline Companion controls, and a native Team → Auto change. Evidence: `.impeccable/review/cursor-agents/packaged-macos-auto.png`. Renderer fixtures also exercise all four cloud variants, desktop/narrow controls and keyboard selection. The correction passes 55 focused tests, including four asset-transport tests for animation/poster WebP bytes and three startup-isolation tests. Integration checks cover shared mode, failure/retry, account cleanup, keyboard selection and ordinary-tab execution. An intermediate whole-workspace typecheck hit unrelated in-progress docking API mismatches. After that concurrent migration progressed, the final whole-workspace typecheck passed: `/tmp/misty-companion-page-typecheck-final.txt`. The final Vite desktop build also passed: `/tmp/misty-companion-page-vite-final.txt`.

Pure-modifier shortcut testing could not be driven by the local UI automation API; voice and multi-monitor acceptance below remain pending.

## Evidence collected locally

| Check | Result |
| --- | --- |
| Frontend desktop build and TypeScript | Passed |
| Focused frontend tests | Passed: 63 tests across 7 files covering companion protocol/lifecycle, ordinary-tab routing, existing execution/voice/shared-history/layout |
| Native audio tests | Passed: bounded WAV size at high device rates and empty/rapid recordings |
| Server HTTP API tests | Passed: companion validation/history/modes and existing invocation/voice paths |
| Agent runtime TypeScript | Passed |
| Renderer review | Passed following, recording, processing, pointing and controls in a fixture; not native acceptance |
| macOS package | Unsigned debug `src-tauri/target/debug/bundle/macos/Misty.app` built and launched into the browser shell; test launch then closed. Screenshot: `.impeccable/review/cursor/packaged-macos-startup.png`. No live companion acceptance claimed. |
| Windows platform adapter | Actual platform module typechecked against windows-sys using a temporary isolated probe |
| Full Windows app | Not built locally: cross-build stopped at native C dependencies because this Mac lacks Windows SDK headers |

Local command logs: `/tmp/misty-cursor-{build-final,typecheck-final,tests-final,native-final,package-final,eslint-final}.txt`, `/tmp/misty-cursor-go.txt`, `/tmp/misty-cursor-runtime-tsc.txt`, `/tmp/misty-cursor-windows.txt`, and `/tmp/misty-cursor-windows-probe.txt`. Renderer captures are under `.impeccable/review/cursor/` and use mocked native events.

The native desktop CI workflow now includes companion tests and produces unsigned macOS/Windows acceptance packages on its next run. That workflow was not dispatched in this session. CI compilation does not establish live acceptance.

## Required packaged acceptance, still pending

Record OS version, package revision, display layout/DPI, observed result and evidence for each row on **both platforms**. Use an authenticated test account and real server/runtime providers.

| Scenario | Required result | macOS | Windows |
| --- | --- | --- | --- |
| Global shortcut in another app/fullscreen | Non-consuming hold/release; no focus theft; click-through follower | Pending | Pending |
| Rapid press/release and interruption | No stuck mic, speech, spinner or point; new press cancels previous execution | Pending | Pending |
| Microphone/capture denial and provider failure | Clear control-panel error; idle or transient-hidden state; retry works | Pending | Pending |
| Connected displays | All labeled captures, correct cursor primary, overlays excluded, Misty windows retained | Pending | Pending |
| Mixed DPI/negative origins/display removal | Accurate pointing and return; removed display cancels point without stuck visibility | Pending | Pending |
| Hidden companion | Shortcut shows it temporarily; hides after speech and pointing finish | Pending | Pending |
| Team question and explicit handoff | No unsolicited actions; delegated work returns control and speaks confirmed results | Pending | Pending |
| Auto multistep task | Ordinary Misty tabs, correct account/tab, fresh post-action visuals, real reference links | Pending | Pending |
| Mode change while executing | Interrupt first; preserve completed history; questions about modes do not change mode | Pending | Pending |
| Logout/account change during capture/speech/actions | Activity stops, native controls clear, no old results/captures reach next account | Pending | Pending |
| Original Agents and sync | Existing worker tasks still work; account-owned history and sync behavior retained | Pending | Pending |

Do not mark the platform complete until every row has packaged-app evidence. The local session did not exercise live OS permissions, real speech or an authenticated end-to-end browser task.
