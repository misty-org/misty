# Planner, as an app on misty-sdk

The Planner rebuilt as its own bundle: a sandboxed frame that talks to Misty only through `@misty/sdk`
(`tasks.*`, `members.list`, `me()`), with no host code. It is its own package, built apart from Misty:

```bash
npm install && npm run build
```

`dist/` is the bundle (`misty-app.json`, `logo.svg`, `index.html` and its assets). Copy it to
`src-tauri/resources/apps/planner/` for Misty to ship it (and add `"resources/apps": "apps"` to
`tauri.conf.json` once that folder exists); Misty seeds it into the app cache at launch, and a Space that has
Planner installed (`version: "bundled"`) runs it in a `SpaceAppFrame`.

Not here yet, against the host's Planner page: drag to reorder, priorities and due dates in the editor, the
assignee picker, and the agent tools (`task.*`), which move into this app's MCP server.
