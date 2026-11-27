# The browser harness

A browser harness for agents that runs on the system webview: WKWebView on macOS, WebKitGTK on
Linux. No Chromium to bundle, no DevTools protocol (CDP) and no Playwright. Pages are read and
driven from a script world of the harness's own, which shares the page's DOM but not its
JavaScript, so a page can neither see the harness nor forge what it reads. Clicks and keys arrive
as native, trusted input.

It is how Misty's agents read and act on every web page they work in: the agent browser's tabs and
every app, since apps are web builds. It lives in its own folder so it can be tested and
benchmarked on its own; run the commands below from `harness/`.

## What's here

| Path | |
| --- | --- |
| [`crates/page-runtime`](crates/page-runtime) | The in-page runtime (`js/`): accessibility snapshots with refs that survive actions, actions by ref, waits without model calls, page text. A Rust crate that hands hosts the script. |
| [`crates/host`](crates/host) | `harness-host`: a bare window with the system webview that runs the runtime in its own world. macOS for now. |
| [`tests`](tests) | The runtime's tests, in jsdom. |
| [`benchmarks/bu-bench`](benchmarks/bu-bench) | BU Bench V2.1 through Misty, scored by the benchmark's own judge. |

## Using it

Run the runtime's tests:

```bash
npm install && npm test
```

Load a page in the standalone host and print its snapshot:

```bash
cargo run -p misty_harness_host -- https://example.com
```

Any runtime operation, with its arguments as JSON, and `--keep-open` to keep the window:

```bash
cargo run -p misty_harness_host -- https://example.com find '{"query": "More information"}' --keep-open
```

Misty builds `crates/page-runtime` from here through a path dependency in `src-tauri/Cargo.toml`, so
a change to the runtime reaches the app on its next build.

## Where it's going

1. **Done:** the page runtime and its tests live here; a standalone host on macOS.
2. The Rust page logic (step checks, batches, waits, consent, site blocks) moves here behind a
   host interface built on native webview handles, which Misty's Tauri windows and the standalone
   host both provide. Native input, captures and cross-origin frames come with it.
3. The standalone host serves the harness's tools over MCP, so engines and benchmarks run on it
   without the Misty app.
4. The WebKitGTK host. Windows is open: WebView2 has no native isolated worlds, and Misty reaches
   them there through WebView2's in-process DevTools calls today.

## License

Misty's: AGPL-3.0-or-later, with the attribution term and the credits for what the harness follows
in [NOTICE](../NOTICE).
