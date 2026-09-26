# Browser implementation ledger

Owner: Misty desktop browser. Started 2026-09-24.

## Direction

Finish a dependable everyday browser before expanding agent browser features. macOS uses the system WKWebView engine; Misty owns its navigation, permissions, privacy, persistence, and user interface. Existing agent functionality is not expanded by this work.

This is the source of truth for sequential implementation. Mark individual items complete only with implementation and validation evidence. Code inspection is not website compatibility validation. Keep unfinished items explicit; do not call an entire phase complete because one subtask shipped.

## Existing baseline

- Address bar, Google search, back/forward, reload, loading/error states.
- Tabs, reopen closed tabs, virtual windows, split panes, restored workspace layouts.
- Saved websites, groups, pins, editing and reordering (existing bookmark system).
- Native downloads and attachment handling with completion/error notices.
- Native upload file picker, zoom, context menus.
- Persistent website cookies/data and profile infrastructure.
- Device sync is Preview. Annotations, viewport presets and bounded agent integration exist.

## Ordered implementation

The detailed pages below are the canonical records for individual browser items.
This file remains the browser sequencing and baseline index; do not duplicate
item status here. See the [public roadmap](../../ROADMAP.md) and
[maintenance/status guide](../roadmap/README.md).

1. [B01 — Site permissions and privacy](../roadmap/browser/permissions.md)
2. [B02 — Everyday page tools](../roadmap/browser/page-actions.md)
3. [B03 — Downloads you can manage](../roadmap/browser/downloads.md)
4. [B04 — History and saved websites](../roadmap/browser/history-bookmarks.md)
5. [B05 — A browser you can rely on](../roadmap/browser/compatibility.md)

Work in this order. The first milestone was already in progress when this ledger
was reorganized; its individual items had no recorded completion evidence.

**Next review target:** B01-01, website camera/microphone prompts. Inspect the
current implementation before changing it; this is a queue selection, not a
claim that nobody is already working on it. Record the actual owner in that item.

Extensions, reader mode, translation, and further agent features follow this
baseline. They are future directions, not commitments for the current milestone.

## Validation log

- 2026-09-24: Baseline audited in source. No end-to-end compatibility certification. Initial issue: vendored Wry media delegate unconditionally returns Grant. Initial resource concern: browser creation disables background throttling.


### Increment 1: website media permissions and site information

Implemented on macOS. Website controls are at the information button beside the address. Saved choices for currently open profiles are in Settings → Privacy → Website permissions. New profiles default to Ask; temporary stores do not persist decisions. Preferences are local, keyed by the physical WebKit data-store identifier and canonical origin. They are not synchronized into another device or inherited by a replacement data-store generation.

The native callback honors the requesting origin's saved Block and a top-level site's Block. A cross-origin frame never inherits an Allow. Popups retain Wry's upload/opener behavior and receive the permission delegate. Blocking/resetting stops the affected device across the same browser profile, including embedded frames. UI mutation errors refresh the authoritative persisted choice while retaining any capture-stop warning.

Validation:

- Four Rust policy tests pass: canonical origins (including ports/IPv6), prompt defaults, mixed media decisions, requesting-frame/top-level blocking and cross-origin Allow handling.
- Six UI tests pass: correct origin/profile mutation, navigation races, rejected writes, saved-state reconciliation after capture-stop errors, and Settings reset behavior.
- Focused ESLint passes. TypeScript passed during implementation; the final rerun is blocked by concurrently changed `src/features/browser-workspace/controller.test.ts:172,177` calling a missing `WorkspaceSyncController.flush` method, outside this increment. Native macOS development build succeeds.
- Actual WKWebView UI inspected: encrypted HTTPS vs local HTTP connection state; camera choice saved; local fixture camera request rejected with NotAllowedError; saved choice visible in Settings. A separate process read the persisted test choice from macOS preferences. The temporary localhost choice was removed after verification.
- Native screenshots: `.impeccable/review/browser-permissions/site-info.png` and `settings.png`. Independent finish review: ship; documentation updated in DESIGN.md.
- Broader BrowserWorkspace/Settings regression run: 39 passed, two existing unrelated expectations fail (external-browser button label and Settings indentation class).
- A concurrent sync change added Session.api; its existing test fixture required the missing `api` field to compile the native test target.

Remaining validation: actual camera/microphone granting and live-stream revocation, OS-level denial, full restart/account switching, and embedded-frame media requests on hardware. These are still open in phase 5; passing policy tests is not a hardware compatibility claim. This increment does not complete phase 1 or the full browser ledger.

Next implementation item: clearing website data with profile scope and sync coordination, followed by private browsing isolation. Do not erase native cookies alone while the credential-sync vault can restore them.

The final native fixes were built and signed into the local dev1 bundle. The currently running process needs a restart to load that last build; no further restart was forced while the workspace was being used.
