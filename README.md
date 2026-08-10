# Misty

Misty is a single repository for the desktop application, browser application, public website, and service API.

## Projects

| Directory | Purpose | Primary stack |
| --- | --- | --- |
| [`app`](./app) | Tauri desktop application and browser build | React, TypeScript, Rust |
| [`website`](./website) | Public Misty website | React, TypeScript |
| [`server`](./server) | Misty HTTP API and background services | Go |
| [`cli`](./cli) | Misty command-line interface | Rust |

## Common commands

```sh
npm install
npm run dev:app
npm run build:app
npm run dev:website
npm run build:website
npm run check:web
```

Run server commands from [`server`](./server) and CLI commands from [`cli`](./cli); both remain self-contained modules.

## Cloudflare Workers

Create one Worker Builds project for each browser-facing application. Both
projects use Wrangler's static-assets deployment with SPA navigation fallback.

- `misty-web-app`: root directory `app`, build command `npm run build:web`,
  deploy command `npx wrangler deploy`, and build variable
  `MISTY_PUBLIC_API_URL=https://mistysys.com/api`.
- `misty-website`: root directory `website`, build command `npm run build`, and
  deploy command `npx wrangler deploy`.

The asset directories and Worker names are declared in each project's
`wrangler.jsonc`. Attach `app.mistysys.com` to `misty-web-app` and
`mistysys.com` to `misty-website` from each Worker's Domains & Routes settings.
