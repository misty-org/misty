# Misty Plugins

The official first-party plugin workspace for Misty.

Plugins are now authored with the same frontend stack as `apps/desktop`: TypeScript, React, Vite, and Tailwind CSS. There is no native plugin ABI in this repo anymore; plugin panels run as web surfaces and talk to Misty through a small host bridge.

## What's Here

| Path | Contents |
|------|----------|
| `src/` | React plugin panels and shared web plugin bridge |
| `plugins/*/manifest.json` | Local install manifests with web runtime metadata |
| `plugins/*/plugin.json` | Hub/local plugin details used by Misty |
| `catalog/` | Public catalog index and marketplace entries |
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

## Host Bridge

When Misty hosts a web plugin, it can attach `window.mistyPluginHost`:

```ts
window.mistyPluginHost = {
  selectedPaths: async () => ["/path/from/files"],
  notify: ({ level, title, message, pluginId }) => {},
  runCommand: async (command, payload) => ({ ok: true }),
};
```

Without that bridge, panels still run in browser-smoke mode so UI work can continue independently from desktop host integration.
