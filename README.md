# Misty Store

The official first-party Store app workspace for Misty.

Plugins are now authored with the same frontend stack as `apps/desktop`: TypeScript, React, Vite, and Tailwind CSS. There is no native plugin ABI in this repo anymore; plugin panels run as web surfaces and talk to Misty through a small host bridge.

## What's here

| Path | Contents |
|------|----------|
| `src/` | React plugin panels and shared web plugin bridge |
| `extensions/*/manifest.json` | Local install manifests with web runtime metadata |
| `extensions/*/plugin.json` | Hub/local plugin details used by Misty |
| `catalog/` | Public catalog index and marketplace entries |
| `interface/` | Shared catalog contract and React presentation primitives |
| `scripts/build-plugins.mjs` | Copies plugin metadata/assets into `dist/` after Vite builds |

## Development

```bash
npm install
npm run dev
```

Open a plugin directly with a query string:

```text
http://127.0.0.1:5174/?plugin=quick_convert
http://127.0.0.1:5174/?plugin=themes
http://127.0.0.1:5174/?plugin=vault
http://127.0.0.1:5174/?plugin=ytdlp
http://127.0.0.1:5174/?plugin=preview-panel
```

You can simulate a selected file with:

```text
http://127.0.0.1:5174/?plugin=quick_convert&selected=/Users/me/Desktop/demo.mov
```

## Build

```bash
npm run build
```

The build emits the web app plus installable plugin metadata under `dist/`:

- `dist/index.html`
- `dist/assets/*`
- `dist/plugins/<plugin>/manifest.json`
- `dist/plugins/<plugin>/plugin.json`
- `dist/catalog/*`

Each `dist/plugins/<plugin>/` directory is self-contained and can be zipped as an install bundle. Tagged releases build and publish `quick_convert.zip`, `themes.zip`, and `ytdlp.zip`; catalog entries point to those versioned bundles rather than an unbuilt source archive.

## Host Bridge

When Misty hosts a web plugin, it can attach `window.mistyPluginHost`:

```ts
window.mistyPluginHost = {
  selectedPaths: async () => ["/path/from/files"],
  notify: ({ level, title, message, pluginId }) => {},
  runCommand: async (command, payload) => ({ ok: true }),
};
```

Hosted panels use the same typed command contract over `postMessage`; Misty validates the iframe source, plugin id, and a per-plugin command allowlist before invoking native functionality. Without a host, panels remain available in browser-smoke mode and clearly disable system actions.

## Shared catalog interface

`interface/` is the canonical presentation dependency for the desktop Store and
the public website. It owns the extension data shape, stable URL helpers,
platform labels, filtering behavior, artwork treatment, and verification badge.
Each product synchronizes this small source distribution before development and
builds, then supplies its own theme variables and product-specific layout.

Change shared extension presentation in this repository first. The consumer
repositories keep generated copies so builds remain reproducible and can verify
drift without requiring a network connection.

After `main` passes CI, the repository dispatches
`extension-interface-updated` to `misty` and `misty-website`. Configure the
organization-scoped `MISTY_REPO_DISPATCH_TOKEN` Actions secret with permission
to dispatch workflows in both repositories. Their sync workflows validate and
commit the refreshed generated sources, which also triggers the normal website
deployment pipeline.
