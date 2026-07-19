# Product Research demo harness

The versioned `product-research-hub@2` scenario creates a shared Product Research Hub for Maya Chen and Jordan Lee. It seeds six committed fixtures, Core Evidence, an Everyone thread, a private two-person launch conversation, Summarizer, and New Evidence -> Summarization Queue through normal product APIs. Only destructive reset and deterministic Agent attribution use the internal demo API.

Summarizer has the workflow Misty creates for every Agent. The standalone intake workflow deliberately uses deterministic, unmetered cloud nodes so local demos work without AI credits. Automatic Library-upload triggering, blob-aware image/PDF analysis, and metadata tag writes are not represented as working features until those runtime capabilities exist.

## Commands

```bash
npm run demo -- --target local
npm run demo:seed -- --target local
npm run demo:verify -- --target local
npm run demo:live-check -- --target local
npm run demo:clean -- --target local
```

The local target owns the `misty-demo` Compose project, PostgreSQL on port 5436, the demo API on port 8081, and dedicated PostgreSQL and Library volumes. It never stops an unrelated process occupying 8081. `MISTY_DEMO_SERVER_PORT` is available for isolated harness development, while 8081 remains the standard demo port.

Local credentials are generated once in ignored `.demo/credentials.json` with mode `0600`. Reports and the non-secret state manifest live below ignored `.demo/`. Ordinary resets preserve the two accounts and all active sessions. `demo:clean` is the only command that destroys the local volumes and credentials.

## Dedicated staging

Staging must run the server with `MISTY_DEMO_MODE=staging`, a 32-character-or-longer `MISTY_DEMO_ADMIN_TOKEN`, a database name containing `demo`, and a private R2 bucket name containing `demo`. The server refuses production mode, shared database names, shared storage names, and missing demo storage.

Configure the runner without checking secrets into the repository:

```bash
export MISTY_DEMO_SERVER_URL=https://demo-api.example.com
export MISTY_DEMO_ADMIN_TOKEN=...
export MISTY_DEMO_OWNER_PASSWORD=...
export MISTY_DEMO_COLLABORATOR_PASSWORD=...
npm run demo:seed -- --target staging
```

The optional live check warns and exits successfully when managed AI is unavailable or credits are exhausted. The deterministic Agent message and non-AI workflow run remain the demo's acceptance source of truth.
