# Building Misty

We’re building a browser workspace where you can organize your work, continue
across computers, and work alongside agents in your real browsing context.

This is our living roadmap: what we’re working toward, what exists, what has
been tested, and what people can actually use. Plans can change as we learn.
An implementation or a passing test does not automatically mean a feature has
been released.

## Our focus now

**Make Misty a dependable everyday browser.** We’re starting with website
permissions and privacy, followed by essential page tools, downloads, history,
and real-world compatibility. Existing agent functionality remains part of
Misty; expanding it comes after this baseline.

| In order | What this means for you | Follow the work |
| --- | --- | --- |
| 1 | Choose what websites can access and control your browsing data. | [Permissions and privacy](docs/roadmap/browser/permissions.md) |
| 2 | Find text, stop loading, print pages, and choose a search engine. | [Everyday page tools](docs/roadmap/browser/page-actions.md) |
| 3 | Track downloads, retry failures, and find saved files. | [Downloads](docs/roadmap/browser/downloads.md) |
| 4 | Find previous visits and organize saved websites. | [History and bookmarks](docs/roadmap/browser/history-bookmarks.md) |
| 5 | Rely on sign-ins, uploads, media, and workspace recovery. | [Compatibility and resource use](docs/roadmap/browser/compatibility.md) |

Each page holds the current status, acceptance criteria, next steps, and evidence
for its items. The [browser ledger](docs/implementation/browser-ledger.md)
records the existing baseline and implementation sequence.

## The larger direction

| Area | What we’re working toward | What we can say today |
| --- | --- | --- |
| Browser workspace | Organized websites, tabs, split panes, and windows that retain your working context. | Existing implementation is recorded in the browser baseline; this is not a certification of everyday website compatibility. |
| Device continuity | Bring your workspace and supported website sessions to another computer. | Preview. Development capture/restoration paths exist; complete cross-device website acceptance is not established by this roadmap. |
| Agents | Delegate work in your browsing context, watch progress, and take control. | Existing bounded integration. Wider agent capabilities have a separate engineering ledger and are not all available or verified. |
| Files and shared work | Keep useful files and intentionally shared context close to the task. | Existing product surfaces; detailed public inventory and current verification still need reconciliation. |

This first public-facing edition migrates **all 31 acceptance items from the new
browser ledger**. It is not yet a full inventory of everything in Misty. Broader
engineering records remain authoritative until their items are individually
reviewed and mapped here; older plans are not automatically new commitments.

## How to read progress

- **Work:** exploring, planned, in development, blocked, deferred, or complete.
- **Implementation:** not assessed, not started, partial, implemented, or not applicable.
- **Validation:** not recorded, automated only, manually verified, or acceptance verified, always with platform and scope.
- **Availability:** not confirmed, development only, preview, beta, or released, with a build or release link when confirmed.

A feature can be implemented and still need testing. It can pass tests and still
be unavailable in a downloadable build. “Complete” means its stated acceptance
criteria have evidence; availability tells you whether you can use it.

We do not show an overall completion percentage: a small shortcut and reliable
cross-device sessions are very different amounts of work. Known limits belong
beside the feature, including differences between Mac and Windows.

## Later ideas

Extensions, reader mode, translation, and expanded agent features are recorded
as later directions. They have no promised date. New ideas enter exploration
before joining the implementation queue.

## Follow or contribute

Follow the linked feature pages and their dated updates. When reporting a problem
or proposing a change, include its stable item ID, such as `B01-01`, your platform,
and the behavior you expected. Please leave out account secrets and private data.

Contributors can use the [maintenance guide](docs/roadmap/README.md) and
[item template](docs/roadmap/TEMPLATE.md) to keep implementation, evidence, and
public progress connected.

Last reviewed: 2026-09-24. This document prepares a public-facing view; it does
## Contributor tooling

The server and CLI now share this checkout. Follow the [CLI and server consolidation ledger](docs/implementation/cli-server-consolidation.md) for setup, diagnostics, container output, and validation status.
