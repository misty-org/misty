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

Copy `.env.example` to `.env` for local development. Browser API requests use
the same-origin `/api` path by default; the Vite development server can proxy
that path to a local server through `VITE_API_PROXY_TARGET`.

## Cloudflare Workers

The Worker is declared in `wrangler.jsonc` as `misty-website`. It serves the
`dist/` build as static assets and falls back to `index.html` for SPA routes.
Configure Cloudflare Workers Builds with:

- Production branch: your default branch.
- Root directory: `website`.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.
- Custom domain: `mistysys.com`.

No production API URL is required while the website and API share
`mistysys.com`; requests remain on the `/api` path.
