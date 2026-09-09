# App integration milestones — September 5, 2026

The current requested pass is Browser's dropdown regression followed by Library, Social, and Agents as downloadable desktop components. Code is explicitly deferred. The user requested no tests or broad checking in this pass; only SDK compilation, component/host/Go builds and signed packaging were run. No publication or deployment is authorized by this checklist.

An app milestone is complete when its existing core UI runs from an independently built, verified downloaded package, uses SDK methods for its actual host/server needs, appears in the navbar, opens applicable tabs/panels, performs representative read/edit/save actions and closes/uninstalls cleanly. Stubs, stripped-down screens and authenticated host-store imports do not count.

## App order and actual remaining work

| Order | App | Current state / next concrete deliverable |
| --- | --- | --- |
| Verified locally | Terminal | Signed downloaded component. Retain its existing native PTY and lifecycle evidence; include it in the final combined smoke check. |
| Verified locally | Planner | Signed downloaded component. Retain existing SDK/core-workflow evidence; include it in the final combined smoke check. |
| Verified locally | Browser | Signed downloaded component with actual host/native install, navigation, panels and cleanup proof. Include in final combined smoke check. |
| Verified locally | Journal | Signed downloaded component with host/native lifecycle, editing, collaboration, clipboard and export evidence. Include in final combined smoke check. |
| Verified locally | Inbox | Complete SDK UI and rebuilt signed 1.1.0 package promoted locally. Actual native Discover install, navbar, mail reading, draft create/update, two panels, close and removal pass. Compiled attachment/AI flow passes with SDK device/server fixtures. Real provider OAuth/send and the physical attachment picker are not claimed by these fixtures. |
| Built and signed locally | Files | Full SDK Files workspace packaged as downloaded desktop 1.1.0. Includes shared preview, branches, local/connected sources, drop handling, and scoped file operations. Native host and SDK builds completed; runtime workflows were not rerun in the no-tests migration pass. |
| Built and signed locally | Library | Downloaded desktop 1.1.0; existing collection, viewer, photo editor and file picker UI uses scoped SDK Library operations, binary transfers and clipboard services. Built and development-signed; no live-account workflow verification in this pass. |
| 4 | Chat | Reuse current messaging UI and file adapters. Connect required conversations/messages/reactions, attachments and realtime methods. Verify message delivery/reconnect through controlled accounts and native package lifecycle; preserve outbound-message authorization. |
| Built and signed locally | Agents | Downloaded desktop 1.1.0; existing chat, streaming, images, voice, browser research, MCP and automation UI uses scoped SDK services and Go endpoints. No live agent/provider workflow verification in this pass. |
| Deferred by user | Code | Remains embedded for this first pass. Existing SDK editor work is retained. |

## Essential shared acceptance

- Map each final app's actual native/server dependencies to typed SDK contracts, with capabilities, ownership, errors and cleanup. Fix missing methods and observed integration failures. Do not implement every historical route or match unrelated method counts.
- Keep signature and extracted-file verification, per-app/account/Space permissions, file ownership, data integrity and essential install/open/save/close behavior. Downloaded app builds reject direct native imports, raw host credentials and direct authenticated server transports.
- Keep the six existing extensions working through the SDK: quick_convert, themes, storage_report, image_optimizer, backups and ytdlp. Reuse current implementations and perform one representative owned-fixture workflow and lifecycle check per extension, fixing actual failures. Their separate native WebView runtime remains appropriate; no iframe is required.
- Deferred until separately requested: after app assembly, run one bounded combined macOS pass: visible/stable desktop startup, all ten apps in Discover, verified download/install, navbar and applicable tab/panel opening, representative saved state/restart behavior and cleanup/uninstall. Reuse unchanged app evidence; rerun wider suites only for demonstrated cross-app regressions.
- Verify the independent public SDK packages build and work in a consumer without private repository dependencies. Coordinate only concrete required server contracts; use the existing backend wherever it suffices.

## Deferred work

Windows/mobile follow working macOS integration. Also defer speculative hardening, exhaustive fault matrices, unrelated legacy repairs, cosmetic polish, generic framework refactors, performance work without a demonstrated usability blocker, and unrelated backend replacement/payment/retention programs. These deferrals do not remove existing core app workflows, permissions, ownership, data integrity or signed-package validation.

## Evidence and bounded stopping points

Detailed completed work and its limitations remain in [implementation.md](./implementation.md). The static [SDK audit](./sdk-audit.md) is an inventory, not a completion percentage. No ETA or percentage is inferred from method/test counts.

The in-progress native Code change reached a safe stopping point: native owned-folder startup compiles; two focused checks pass, including actual clangd startup and process cleanup after release/late revocation. It is not yet connected to the public SDK or DownloadedAppSurface. Further Code work is parked behind the independent app integrations above.

**Next app deliverable is Files' existing explorer running through SDK adapters and its native package lifecycle.** Inbox's normal local catalog promotion is complete. Do not turn a missing provider credential into an excuse to delay independently verifiable app integration, and do not claim a provider flow passed when only a fixture was exercised.
