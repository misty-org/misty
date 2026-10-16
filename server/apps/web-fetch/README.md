# web-fetch

`web.fetch` for agent runs when none of the person's devices is online: schedules, `+misty`
email and integration entries (docs/plans/agent-harness.md, phase 1). Runs with a device read
pages on the device instead (`src-tauri/src/infra/web_fetch.rs`).

It reads one public page without cookies, follows at most five redirects, re-checks every hop,
caps the body at 2 MB and returns readable text: the whole page, or for long pages the parts
that match the agent's question. It keeps nothing and never reaches Misty's own servers.

## Deploy

```bash
npm install
npx wrangler secret put MISTY_WEB_FETCH_SECRET
npm run deploy
```

Then give the API the Worker's address and the same secret (32 characters or more) in
`server/.env/<env>/integrations/web-fetch.env`:

```
MISTY_WEB_FETCH_URL=https://misty-web-fetch.<account>.workers.dev
MISTY_WEB_FETCH_SECRET=...
```

Without both, the API offers `web.fetch` only through an attached device.
