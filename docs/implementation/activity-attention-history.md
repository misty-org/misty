# Activity: one feed and quiet diagnostics

Implemented across Misty, official apps, and the public SDK. The bell opens one floating Activity panel over the current workspace. The toolbar offers All, Unread, Mentions, and System sections with counts calculated after search and filters but before section selection. Type and status filters use OR within each group and AND between groups; search matches every word across title, description, and source label. Sort uses latest event time, then ID. The fixed footer marks or clears matching entries across the entire scrollable result set; unresolved requests are preserved. Filtered reads use local item receipts rather than the server-wide inbox-seen endpoint. Clearing persists transition receipts to prevent resurrection. Closing resets view controls. Saved `/activity` links and request details still open inside the popup.

## Event rules

`activityPolicy.ts` owns classification, category eligibility, request state, mute behavior, and transition identity. Producers do not control counts. Mentions, replies, reminders, and completed jobs are unread updates. Approvals, invitations, and blocked work remain requests until confirmed resolution. Opening the feed checks currently available events without marking updates read or resolving requests. Read events remain in the same feed. A number takes priority over the unseen-update dot; native badges use only the number.

`systemActivity.ts` records sanitized diagnostics without Activity or OS delivery. Foreground components render errors locally with their existing recovery controls. Native transfer batches, SDK file transfers, extension jobs, and agent-task results produce operation outcomes. Regular Files saves/toasts do not produce Activity. Planner currently has no reminder scheduler to migrate; the reminder event category and policy are supported without adding a new scheduling service.

## SDK operation contract

```ts
await misty.activity.operation({
  operationId: "export-occurrence-id",
  revision: 1,
  status: "running",
  title: "Export in progress",
});
await misty.activity.operation({
  operationId: "export-occurrence-id",
  revision: 2,
  status: "completed",
  title: "Export ready",
  body: "Open the app to review the result.",
  route: "/apps/journal",
});
```

Use one occurrence ID across a job's retries, and strictly increasing revisions for transitions. A later independent job needs a new ID. Supported states are running, blocked, completed, and resolved. Report a batch/run, rather than every file or step. Blocked work must lead to the app's existing recovery controls. The host binds account, app, and Space ownership, restricts destinations to the owning app/Space, and rejects authority fields or arbitrary notification flags. The old string `activity.report` remains diagnostic-only.

## Local persistence and delivery

Activity storage version 2 scopes records, read keys, mute preferences, categories, and checked-history baselines by account and deployment. Identifiable legacy polling/app errors become diagnostics. Legacy genuine failures remain, and pre-upgrade History is treated as checked. There are separate bounded pools for diagnostics and historical items; unresolved requests are exempt from history eviction.

Refresh failure or partial lists cannot resolve requests. Confirmed approval/intervention decisions resolve immediately even with pagination, and stale lists cannot reopen them. Source history is retained locally; comprehensive cross-device history/read synchronization remains deferred.

Eligible transitions are recorded before native delivery. Repeated revisions, reconnects, and rehydration do not replay banners. Native notifications retain global permission/sound preferences, category controls, focus suppression, and generic mobile content. Muted ordinary events remain in Activity; required requests still count but stay silent. Device work first encountered after signing into a different account is conservatively ignored instead of being attributed to that account.

## Validation

Focused host/app tests cover policy, lifecycle, migration, isolation, producers, SDK ownership and destination validation, source reconciliation, shared UI, and native delivery. SDK build, type checks and contract tests pass. Misty and misty-apps type checks pass. The deterministic rendered fixture checks desktop/mobile views, viewport overflow, and panel and filter-menu keyboard operation.

Native-delivery tests mock the Tauri boundary; actual OS banner delivery and physical mobile devices were not exercised. The rendered fixture uses shipped components without a live authenticated backend. No commits, pushes, or deployment are part of this change.
