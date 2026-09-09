# Integration panel consistency scan

Reference: Social and Inbox's existing `PlatformPanel` popup, compact unboxed provider rows, original brand icons, search, and trailing Add/Open actions.

| App / surface | Before | Resolution |
| --- | --- | --- |
| Social / Inbox popup | Shared `PlatformDirectory`, styled through modal ancestor selectors in `websiteChrome.css`. | Keep the reference layout; make the directory own its styles. |
| Library | Same directory markup, but full-page rows miss `.platform-entry` flex styling. Provider names become boxed cards and actions no longer align. | Apply the reference row layout in both popup and full-page views. |
| Planner / Journal | Same missing full-page row rules as Library; search also depends on unrelated `websites.css`. | Consume the same self-contained directory styling. |
| Files connected storage | Already uses `PlatformPanel` and `PlatformDirectory`, with account/setup screens in the same modal. | Inherit shared directory styling; preserve connection, reconnect, and disconnect flows. |
| All narrow directories | Legacy mobile selector adds a left margin to every direct row button, including the provider entry; minimum copy width can force awkward wrapping. | Keep flexible copy and trailing actions aligned, with wrapped descriptions and larger touch targets. |
| Popup shell | Shared dialog size, heading, Close/Back, scroll body, and focus restoration. | Preserve the shared shell and use an explicit embedded directory state. |

The active source is the sibling `misty-apps/apps/shared` checkout, resolved by the host's app-source tooling, not `vendor/misty-apps`. Both workspaces contain substantial pre-existing changes.

Coverage scan: Browser, Code, Terminal, and Agents do not expose this provider catalog. Their app-specific settings are separate tasks, not alternate integration-directory implementations. Journal's old `NotesIntegrationsDialog` has no active render call. Non-Mac external Inbox remains a provider list and shares the directory's foundational styles.

Routes: all five website apps already expose a scoped `drawer=integrations` popup through the sidebar. `view=integrations` remains a supported standalone directory; it must have the same row UI. Opening a popup over a website must preserve the mounted website and its account session.

## Implemented and checked

- Extracted directory styling into `misty-apps/apps/shared/platformDirectory.css` and imported it from the shared directory's style dependency. Removed competing modal-only catalog rules from `websiteChrome.css`.
- Standalone and embedded directories now share icon sizes, name/description type, search, row alignment, trailing actions, and responsive behavior. Embedded mode only changes the outer frame.
- Added explicit busy semantics and omitted empty description elements.
- Existing regression suites: 28 tests passed across website experiences, connected storage, and sidebar configuration routes. Host TypeScript check passed.
- Browser verification: 12 popup layouts (six apps at 1280px and 390px), plus Library's standalone page at both widths. Checked search/no matches, horizontal overflow, dialog bounds, row/action alignment, Escape, Close, and focus return. No browser runtime errors. Evidence is in `artifacts/integration-panels`; the repeatable renderer is `scripts/integration-panels-render.mjs`.
- Visual evidence uses shipped React components with disposable SDK data in Chromium. Native WebKit and real provider logins were not exercised by this styling pass.
- Production package builds passed for Library, Social, Inbox, Planner, and Journal. Files consumes the shared directory through the host; its storage regression tests and the host type check passed.
