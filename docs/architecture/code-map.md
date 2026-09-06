# Code map

Misty organizes code by platform shell first and product domain second. The mnemonic is: **shells frame; features work; native bridges devices; shared knows no domain**.

```text
src/application/layouts/
  DesktopLayout/       desktop shell, panes, windows and desktop chrome
  MobileLayout/        mobile shell, navigation, projection and switcher
  shared/              shell behavior genuinely shared by both platforms

src/features/<domain>/  domain UI, state and behavior
  mobile/               only for a true mobile-specific feature composition

src/api/                authenticated HTTP contracts
src/native/             cross-domain native bridges
src/shared/             domain-free UI, hooks, utilities and assets
src-tauri/              Rust core and tracked native platform projects
```

## Placement rules

1. Put platform navigation, chrome, sizing, and lifecycle composition in its layout folder.
2. Keep business state and reusable product surfaces in their existing feature. Add `mobile/` only when responsive composition cannot express the interaction safely.
3. Cross-domain operating-system integration belongs in `src/native/`; a bridge used by one feature stays with that feature.
4. `src/shared/` must not import from features, API domains, or native runtime code.
5. Every feature exposes its intentional public API through `index.ts`. Application code imports that public API instead of reaching into feature internals.
6. Stable features stay in place. Prefer narrow extractions and new shell files over a repository-wide move.

## Workspace invariants

Desktop owns pane and virtual-window topology. Mobile reads a flattened, recent-focus projection and may focus or open a tab, but it never collapses, moves, or rewrites desktop layout nodes. Extension and marketplace tabs remain in desktop state while being omitted from the mobile projection.
