# Misty Apps

The App catalog, extension packages, and Discover web experience for Misty.

The SDK now lives in the sibling `misty-sdk` repository as `@misty/sdk` and `@misty/contracts`. Build that checkout first with `npm ci && npm run build`; this repository uses a local package dependency during development.

Misty-built apps are compiled into the trusted Host. Installable third-party Apps are authored with
TypeScript, React, and standard ES-module imports. Their packages produce a self-contained
`index.html`, `app.js` module, and `app.css`. Package code communicates with Misty only through
`@misty/sdk`; credentials, native APIs, and Host globals are never exposed.

Plugins are now authored with the same frontend stack as `apps/desktop`: TypeScript, React, Vite, and Tailwind CSS. There is no native plugin ABI in this repo anymore; plugin panels run as web surfaces and talk to Misty through a small host bridge.

## What's here

| Path                         | Contents                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `src/`                       | React plugin panels and shared web plugin bridge             |
| `extensions/*/manifest.json` | Local install manifests with web runtime metadata            |
| `extensions/*/plugin.json`   | Hub/local plugin details used by Misty                       |
| `catalog/`                   | Public catalog index and marketplace entries                 |
| `interface/`                 | Shared catalog contract and React presentation primitives    |
| `scripts/build-plugins.mjs`  | Copies plugin metadata/assets into `dist/` after Vite builds |

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

Tagged releases publish the Discover site and the platform-specific extension
archives. The official app catalog contains only `embedded` or `unsupported`
platform entries, so release automation cannot publish a second downloadable or
hosted copy of trusted Host code. After publication, the release dispatches that
catalog to `misty-server`; its workflow opens a tested catalog update pull request.

## Misty SDK

An App starts from its ES-module entry and receives the capability-scoped SDK:

```ts
import { defineApp } from "@misty/sdk";

void defineApp({
  mount({ root, misty }) {
    // Render React into root and use only misty.* for host capabilities.
  },
});
```

The SDK uses a versioned message protocol. Misty derives identity from the owning sandbox, validates
every requested capability, and keeps all authentication material in the host process.

## Shared catalog interface

`interface/` is the canonical presentation dependency for desktop Discover and
the public website. It owns the extension data shape, stable URL helpers,
platform labels, filtering behavior, artwork treatment, and verification badge.
Each product synchronizes this small source distribution before development and
builds, then supplies its own theme variables and product-specific layout.

Change shared App presentation in this repository first. The consumer
repositories keep generated copies so builds remain reproducible and can verify
drift without requiring a network connection.

After `main` passes CI, the repository dispatches
`extension-interface-updated` to `misty` and `misty-website`. Configure the
organization-scoped `MISTY_REPO_DISPATCH_TOKEN` Actions secret with permission
to dispatch workflows in both repositories. Their sync workflows validate and
commit the refreshed generated sources, which also triggers the normal website
deployment pipeline.
