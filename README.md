# Misty

Misty is a single repository for the desktop application, browser application, public website, and service API.

## Projects

| Directory | Purpose | Primary stack |
| --- | --- | --- |
| [`app`](./app) | Tauri desktop application and browser build | React, TypeScript, Rust |
| [`website`](./website) | Public Misty website | React, TypeScript |
| [`server`](./server) | Misty HTTP API and background services | Go |

## Common commands

```sh
npm install
npm run dev:app
npm run build:app
npm run dev:website
npm run build:website
```

Run server commands from [`server`](./server); its Go module remains self-contained.

## Cloudflare Pages

Create one Pages project for each browser-facing application:

- `misty-web-app`: root directory `app`, build command `npm run build:web`, output directory `dist`.
- `misty-website`: root directory `website`, build command `npm run build`, output directory `dist`.
