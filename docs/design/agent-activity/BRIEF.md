# Agent activity

Approved 2026-10-10. Mockup: `mockups/index.html`.

How a reply shows its work, in the style of Claude: text and chevrons only, no icons, monochrome.

- Narration and work alternate. What Misty says while working is normal text. Each run of tools between those notes folds into one muted line with a chevron.
- While a step runs, the line names it with its target ("Reading nhs.uk") and a gray highlight sweeps across it. The group is open while it runs and folds itself once it finishes. A person's own open or close choice wins.
- Finished lines say what was done ("Searched web, read page"), never "Used N tools (N failed)".
- The line opens to a bordered table with one row per step: a muted verb, the target in normal text, and a short result or duration on the right. A running row's verb shimmers.
- Rows with something to show have a chevron and open to a small table of rows (pages read, things found) or monospace output.
- A failed step's verb is crossed out and opens to a plain reason. A failed call followed by the same call folds into one row, "Tried 2×".
- Turns Misty sends itself to carry on after a card (connect, approve, screen, browser) show as a centered event line such as "Connected Google Docs · Misty continued", never as a user bubble.
- Motion stops under reduced motion.

## Data

- `tool.detail` events carry an `activity` (`detail`, `result`, `rows`, `output`) built on the server by `toolActivity` from known argument and result fields only. Typed text and prompts are never used, and links show only their site.
- `tool.completed` and `tool.failed` carry `durationMs`, and failures carry a plain `error`.
- The progress endpoint returns the same fields, so history matches what was watched live.
- Continuation turns are sent with `trigger: "continuation"` and stored with `source: "continuation"`. Older turns are recognized by their "Continue the request above." prefix.
