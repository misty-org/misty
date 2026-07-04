---
id: B05
title: "A browser you can rely on"
area: browser
work: planned
order: 5
updated: 2026-09-24
---

# A browser you can rely on

Make everyday websites, sign-ins, media, and recovery work reliably.

[Roadmap](../../../ROADMAP.md) · [Browser ledger](../../implementation/browser-ledger.md) · [Status guide](../README.md)

**Milestone:** Planned. **Prerequisite:** B04.

The milestone status describes scheduling, not completion. Individual implementation, testing, and release evidence has not yet been assessed during this migration. Existing code may cover part of an item.

## B05-01 — Sign in and switch accounts reliably

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Test authentication redirects, opener-dependent popups and multi-account isolation.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B05-02 — Upload and download real files

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Test single/multiple uploads, attachment downloads and interrupted transfers.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B05-03 — Use camera and microphone controls reliably

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Test camera/microphone allow, block, revocation, embedded frames and OS-level denial.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B05-04 — Handle website dialogs and unsaved changes

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Test JavaScript alert/confirm/prompt and before-unload behavior.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B05-05 — Use supported passwords, autofill, and passkeys

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Define and validate system password/autofill/passkey integration; no claims based only on engine support.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B05-06 — See and control playing audio

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Audio indicator/mute and essential media behavior.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B05-07 — Reduce background resource use without losing work

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Review background throttling and inactive-tab memory policy; preserve calls, audio, uploads and unsaved state.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B05-08 — Open links in Misty as your default browser

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Default-browser registration and HTTP/HTTPS opening behavior.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B05-09 — Recover your workspace and recheck device sync

Work: in_development · Implementation: partial · Validation: automated_only · Availability: development_only

Owner: Codex · Updated: 2026-09-24

**Acceptance**

- [ ] Re-run restart/recovery and device sync validation after persistence changes.

**Next step:** Verify actual native browser reopening with unavailable sync, then run the complete restart/recovery and device sync scenarios.

**Evidence:** Local tab creation no longer requires native storage to match the last sync import receipt. It uses the authenticated profile binding; background capture reports storage failures through the existing sync badge. A stopped worker can reuse the same account's already selected profile, and unavailable synced sessionStorage does not prevent opening a local tab. Incoming restore verification, staged-profile isolation, and account-change barriers remain in place. Native regression checks cover failed import read-back, stopped-worker fallback, badge readiness, optional session restore failure, and refusal to reuse another account's profile. On macOS, three native host tests, 24 browser import/restore/capture tests, and 11 sync badge tests pass. No native cookies or website data are cleared by this change. The macOS development build passed and was signed into the local dev1 bundle from the uncommitted working tree on 2026-09-24; the running process needs a restart to load it. Full native restart/device-sync validation remains open.

## Updates

- 2026-09-24: Migrated from the browser implementation ledger. All acceptance criteria retained; no implementation, test, or release status promoted.

- 2026-09-24: Dev-profile sync investigation found a reproducible feedback path: rejected native edits emitted unchanged status, causing renderer retries. Status notifications now require a real change; failed renderer publications back off (1–30 seconds) without dropping edits. Native capture/restore failures also back off (2–30 seconds), and storage warnings do not restart a live worker or repeatedly emit on every tab open. Debug launches resolve Tauri's storage identity and credential scope from the same validated dev profile, including packaged launches without CLI environment; production builds do not use this override. The original native regression failed before the fix and passed afterward. Validation: 45 frontend tests, two worker control tests, six native browser-sync tests and two development-profile tests passed on macOS. Both signed development bundles were rebuilt and launched. Live two-profile sync validation is blocked because both profiles report that their saved sign-in is no longer available; the user must sign in directly. Production Misty was not launched or repackaged. TypeScript and focused ESLint passed. The complete browser-sync crate suite also passed (67 tests).

- 2026-09-24: Startup recovery no longer treats a missing active-device claim, incomplete replay, an offline/terminal connection, or a website-profile recovery failure as a reason to put the local app to sleep. Background startup retries back off from 30 seconds to five minutes, including repeated worker exits after successful cached-vault opens; online-event bursts do not bypass that cooldown. Native sign-in restoration checks for open browser views under the lifecycle write lease and defers background imports instead of closing/reopening pages. Explicit restore retains its deliberate profile-switch behavior. A staged incoming profile no longer blocks the authenticated active local profile. Native recovery failures also back off from 30 seconds to five minutes. The development log separately confirmed full frontend reloads from backend tsconfig edits and generated review previews; those directories are now excluded from Vite watching. Validation: 54 frontend regressions and seven native browser-sync tests pass, including retained interface/input across repeated startup failures, local access during failed sync, and refusal to replace open pages during background restore. An isolated Vite watcher probe verified that frontend edits remain watched while backend config and review files are ignored. The native build passed and signed dev1/dev2 bundles were updated; restarting the development apps loads the native changes. Full live two-device recovery acceptance remains unverified. Production Misty was not launched or repackaged.
