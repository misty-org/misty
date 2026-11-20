# Calendar, as an app on misty-sdk

The Calendar rebuilt as its own bundle: a sandboxed frame that talks to Misty only through `@misty/sdk`
(`events.*`), with no host code. It is its own package, built apart from Misty:

```bash
npm install && npm run build
```

`dist/` is the bundle (`misty-app.json`, `logo.svg`, `index.html` and its assets). Copy it to
`src-tauri/resources/apps/calendar/` for Misty to ship it (and add `"resources/apps": "apps"` to
`tauri.conf.json` once that folder exists); Misty seeds it into the app cache at launch, and a Space that has
Calendar installed (`version: "bundled"`) runs it in a `SpaceAppFrame`.

Not here yet, against the host's Calendar page: week and day views, all-day and multi-day editing, event details, the
attendee list, and the agent tools (`event.*`), which move into this app's MCP server.
