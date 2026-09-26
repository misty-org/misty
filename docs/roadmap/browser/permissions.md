---
id: B01
title: "Site permissions and privacy"
area: browser
work: in_development
order: 1
updated: 2026-09-24
---

# Site permissions and privacy

Choose what websites can access, clear their data, and browse privately.

[Roadmap](../../../ROADMAP.md) · [Browser ledger](../../implementation/browser-ledger.md) · [Status guide](../README.md)

**Milestone:** In development. **Prerequisite:** none.

The milestone status describes scheduling, not completion. Individual implementation, testing, and release evidence has not yet been assessed during this migration. Existing code may cover part of an item.

## B01-01 — Ask before using your camera or microphone

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Replace unconditional website media grants with native prompts.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B01-02 — Remember and revoke site permissions

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Per-origin, per-profile camera/microphone Ask / Allow / Block preferences; persist across restarts; revoke active capture when blocked/reset.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B01-03 — Understand the site you are visiting

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Site information beside the address bar: native current origin, connection state, permissions; do not imply HTTPS proves a site is trustworthy.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B01-04 — Manage permissions in Settings

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Settings access to remembered site permissions and reset controls.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B01-05 — Clear website data without sync restoring it

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Clear cookies, cache and website storage with explicit scope and sign-out explanation; coordinate with sync so erased data does not immediately return.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B01-06 — Browse in a private session

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Private browsing: isolated ephemeral profile, visibly labeled, excluded from workspace recovery, sync, history and persistent permission decisions; discard on close.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## B01-07 — Control location and notifications

Work: planned · Implementation: not assessed · Validation: not recorded · Availability: not confirmed

Owner: unassigned · Updated: 2026-09-24

**Acceptance**

- [ ] Verify geolocation and notification behavior; add supported controls or document platform limitations truthfully.

**Next step:** Inspect the existing path, record what already works, then implement or verify the missing acceptance behavior.

**Evidence:** No item-specific evidence recorded yet.

## Updates

- 2026-09-24: Migrated from the browser implementation ledger. All acceptance criteria retained; no implementation, test, or release status promoted.
