# Misty features

[Get started](../README.md#get-started) · [Roadmap](ROADMAP.md)

Misty is in development. The descriptions below distinguish existing functionality
from preview behavior and planned work. Implementation, validation, and release
availability are recorded separately in the linked ledgers.

## Browser workspace

Organize websites into groups, pin frequently used sites, and work with tabs,
split panes, and virtual windows. Misty restores workspace layouts when reopened.
The browser includes navigation, search, uploads, native downloads, zoom, and
context menus.

The next milestones cover page tools, download management, searchable history,
and everyday website compatibility. See the [browser ledger](implementation/browser-ledger.md).

## Device sync (preview)

The desktop sync implementation targets macOS and Windows. It transfers workspace
changes and supported website data, including cookies and supported local storage,
per-tab session storage, and portable IndexedDB data.

Whether a transferred session stays signed in depends on the website and the data
it requires. A site can request a fresh login. Unsaved page memory, service-worker
caches, passkeys, and non-exportable keys are not transferred. Large or unsupported
website storage can exceed the current implementation's limits.

Cross-device runtime acceptance is still being validated. Both devices must use
compatible apps and the same backend with sync support. The
[handoff checklist](implementation/browser-handoff-test-checklist.md) records
implementation scope and the validation flow.

## Encryption and privacy

Workspace sync data is encrypted on your devices before it reaches the server.
The server stores encrypted data without the secrets needed to unlock it. Local
workspace recovery records are encrypted as well. This does not mean every
website cache or downloaded file is encrypted by Misty.

Camera and microphone controls have an initial macOS implementation. Site
permissions, clearing website data, and private browsing are tracked in the
[privacy milestone](roadmap/browser/permissions.md) and
[browser validation log](implementation/browser-ledger.md#validation-log).
Private browsing isolation is planned: those sessions are intended to stay out
of sync, persistent history, and workspace recovery.

## Agent support

Misty includes agents that inspect and interact with browser tabs through scoped
permissions and execution controls, using your existing browsing context.
Capabilities and validation are tracked in the
[agent readiness ledger](implementation/agents-production-readiness-ledger.md).

Encrypted workspace sync and agent access are separate: page content provided to
an agent may be sent to its configured model provider.
