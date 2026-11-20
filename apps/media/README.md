# Media, as an app on misty-sdk

The Media rebuilt as its own bundle: a sandboxed frame that talks to Misty only through `@misty/sdk`
(`files.*`), with no host code. It is its own package, built apart from Misty:

```bash
npm install && npm run build
```

`dist/` is the bundle (`misty-app.json`, `logo.svg`, `index.html` and its assets). Copy it to
`src-tauri/resources/apps/media/` for Misty to ship it (and add `"resources/apps": "apps"` to
`tauri.conf.json` once that folder exists); Misty seeds it into the app cache at launch, and a Space that has
Media installed (`version: "bundled"`) runs it in a `SpaceAppFrame`.

Not here yet, against the host's Media page: folders, previews and thumbnails, rename and move, and opening a
file in the app that edits it by its kind (Craft apps), which needs the host's `files.open` routing.
