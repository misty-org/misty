# Misty website

The public website contains Misty's marketing pages, authentication flows,
account settings, pricing, and Stripe Checkout handoff.

## Development

From the repository root:

```sh
npm install
npm run dev:website
npm run test:website
npm run build:website
```

The ignored `.env` is the real local configuration. Browser API requests use
the `/v1` path locally; the Vite development server can proxy that path to a
local server through `VITE_API_PROXY_TARGET`. Keep this file limited to public
browser configuration because every `VITE_*` value is bundled into the site.

## Cloudflare Workers

The Worker is declared in `wrangler.jsonc` as `misty-website`. It serves the
`dist/` build as static assets and falls back to `index.html` for SPA routes.
Configure Cloudflare Workers Builds with:

- Production branch: your default branch.
- Root directory: `website`.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.
- Build environment variable: `VITE_API_BASE=https://api.mistysys.com/v1`.
- Custom domain: `mistysys.com`.
