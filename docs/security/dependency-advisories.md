# Production dependency advisory decisions

Misty CI fails for every new high or critical production dependency advisory.
The following advisory-specific exceptions were reviewed on July 28, 2026.
They are not blanket package exceptions.

## GHSA-r5fr-rjxr-66jc — lodash-es template imports

- **Dependency path:** Excalidraw → Mermaid-to-Excalidraw → Mermaid parser →
  Langium/Chevrotain → lodash-es.
- **Reachability:** Misty imports the Excalidraw editor, but does not import or
  invoke Mermaid-to-Excalidraw. No Misty code calls `lodash-es` `template`,
  `unset`, or `omit` through this dependency path.
- **Exposure:** Untrusted drawing or note contents cannot select a lodash
  template imports object. The affected code is therefore not reachable in the
  shipped product flow.
- **Removal condition:** Remove the exception as soon as Excalidraw's Mermaid
  dependency moves to a patched lodash implementation, or remove the unused
  converter from the installed package if Excalidraw makes that possible.

## GHSA-qwww-vcr4-c8h2 — React Router RSC action CSRF

- **Dependency path:** Direct `react-router-dom` dependency.
- **Reachability:** Misty is a packaged, client-only `BrowserRouter`
  application. It does not enable React Server Components, framework-mode
  actions, server actions, or React Router request handlers.
- **Exposure:** There is no React Router RSC action endpoint in the desktop
  application or Go API for a forged request to execute.
- **Removal condition:** Upgrade when React Router publishes a version outside
  the affected range that remains compatible with the client-only application.

## Review procedure

Run `npm run audit:production`. Unknown high or critical advisories fail the
command. For any proposed exception, record the exact advisory, dependency
path, reachable entry points, untrusted inputs, compensating controls, owner,
and a concrete removal condition before changing the advisory allowlist.
