# Agent browser actions: a catalog, obstacles and a vision fallback

Status: draft for approval (2026-10-21)
Graduates to: docs/agents/

October 21, 2026. Draft for approval. Builds on [agent-harness.md](../agents/harness.md)
(`browser_run`, the page API and the page layer). It absorbs the October 19 draft on what an agent
can do on a page (real input and the cursor, below).

## Why

Agents read the page as an accessibility tree and act by ref. That is the right default: the
leaders (Skyvern 3.0, Browser Use's BrowserCode, dassi) are structure-first and use a screenshot
in a few percent of calls. It fails where a page is not what its tree says:

- Animations and scroll-triggered content: the tree is empty or partial until the page is
  scrolled, or it changes under the agent between a read and an act.
- Walls in front of the content: cookie banners, newsletter and app-install modals, age gates,
  login prompts, bot checks (Cloudflare, Turnstile, reCAPTCHA).
- Widgets with no useful semantics: canvas, custom pickers, maps.

Skyvern's own benchmark post names banners and mid-session modals as where agents stall, and live
tasks with writes, logins and CAPTCHAs are where frontier models fall to about a third even when
WebVoyager is above 97%. We already have part of the answer (`declineConsent`, `dismissPopup`,
"covered by X" errors, nearest-scroller scrolling, a vision path in `screenAct`). It is not one
thing the agent can see, and nothing makes the page steady before a read.

## Decisions (October 21)

1. **CAPTCHA and bot checks**: the agent tries to solve them itself, up to three attempts, and
   hands off to the person only when it truly cannot. Blocked is not failed: the run stays
   agentic until something really blocks it, then pauses and resumes. No paid solver.
2. **Human-likeness is a light touch**: scroll in screen-sized steps, wait for the page to settle,
   native input, short natural pauses. No synthetic mouse curves or typing jitter.
3. **A read is the tree plus a picture, the tree stays the source of truth.** The first read of
   each new page, any thin or unsettled read and the read after a failed action carry a small
   marked screenshot (numbered boxes on the tree's own refs); other reads are tree-only. Capped
   per run, and `read({ visual: true })` asks for one.
4. **Benchmarks leave the app's test tree** and become their own package (below).

## Phase 0: the prompt (rules are limits, not recipes)

A system prompt should say what the agent must not do and when it must stop, and leave how to
browse to the model and the tools. Today about three quarters of the browser agent's guidance is
how-to: "Working a page" (about 2,100 characters of search, filter, retry and counting advice),
"Screens" (about 1,650 of tab handling and proof-tab steps) and tool mechanics, each added to
patch one observed failure. The limits (untrusted page data, never enter passwords or codes,
consequential steps only when the person's request includes them, stop for sign-in, report only
what pages showed, no secrets in memory) are short and stay.

- Split the prompt: **tier 1** limits, always on, written as never and stop-and-ask, enforced in
  code where the code can (the consequential gate already is); **tier 2** how-to.
- Run an ablation on tier 2: remove each paragraph in turn and run the three Odysseys tasks and
  the obstacles suite on Nemotron. A paragraph stays only if removing it lowers the score.
- Move tool mechanics into tool descriptions and the page API's catalog entries.
- Move completion rules (proof tabs, counts, sources) out of prose, since the completion gate
  checks them in code.
- A smaller, stable prompt also keeps the cache prefix steady.

## 0. Agent browser: yours while it works

- The tab strip and toolbar never lock. The person can add, switch and close tabs at any time.
- Only the agent's page area is held: Misty's pulsing gray mist (the native page ring) over the
  tab the agent is acting on, with input blocked on that page alone.
- The `+` in the strip adds a blank tab, "Open a URL for the agent to use". An address typed there
  opens a page of the agent's own, bound to the same task, listed in `tabs()` as
  `addedByPerson`. The agent can use it and never closes it. Nothing touches the person's own tabs.

## Exploration without prompt rules

A read of a listing page does a bounded survey (one or two screen steps with a settle) and reports
how far it got and whether more is below. We do not add a prompt rule such as "use the site's sort
first": the obstacles suite gets a superlative task ("cheapest", "newest") and a rule is added
only if the model fails it. Fewer prompt rules keeps the cached prompt small and stable.

## 1. The action catalog

One list, generated from the page layer, that the agent can read (`agent_tool_use("browse")`
loads it) and that the app, tests and benchmarks share. Each entry has a name, arguments, what it
returns, whether it is consequential, and what it does when it cannot act. Grouped:

| Group | Actions |
|---|---|
| Look | `read` (tree), `text`, `find`, `screenshot` (new), `read` with `{ marks: true }` (new: tree plus numbered boxes) |
| Move | `open`, `goto`, `back`, `forward`, `reload`, `tabs`, `keep` |
| Act | `click`, `type`, `fill`, `select`, `check`, `uncheck`, `hover`, `press`, `upload` (new), `pickDate` (new), `drag` (new, same-origin only first) |
| Scroll | `scroll`, `scrollTo`, `scrollUntil` (new: until a target appears or height stops growing), `loadAll` (new: scroll a list to its end with settle waits, returns the count) |
| Wait | `waitFor`, `settle` (new, see 2) |
| Obstacles | `clearObstacles` (new, wraps `declineConsent` and `dismissPopup` and adds the cases in 3), `checkpoint` (new, see 4) |
| Hand off | `requestUser(reason)` (exists as `browser_request_user_action`) |

The catalog is the contract: an action not in it does not exist for the agent, a page-layer action
not in it fails a test. It is generated from the Go descriptors and covers the page API too.

## 2. A steady page before every read and act

`settle(options)` returns when the page has stopped changing, not after a fixed sleep:

- no layout shifts or DOM mutations beyond a small threshold for about 400 ms, no animations or
  transitions running (`document.getAnimations()`), no in-flight fetches from the page, images in
  view decoded; capped at 3 seconds so an infinite carousel cannot hang a run.
- `read` and every act call it first (an option to skip it). A read returns `settled: false` and
  what was still moving when it hit the cap, so the agent knows the tree may change.
- Scroll-triggered content: when the page height or the tree grows after a scroll, `scroll` says
  so; when a first read has little content, `read` returns `thin: true` (see 5).

## 3. Obstacles: `clearObstacles`

Run once after every navigation and again when an act fails with "covered by". It handles, in
this order and only what is actually in view:

1. Cookie and consent banners: reject or necessary-only (exists); never "accept all" unless it is
   the only way past, then say so in the result.
2. Overlays and modals: close controls (exists); newsletter, app-install, promo, chat widgets,
   age gates that only ask for confirmation of the page's own region.
3. Sticky bars and interstitials that cover the viewport.
4. Login walls: not cleared. Reported as `login_required` so the agent can use a saved sign-in or
   hand off.

It returns what it did (`declined cookies`, `closed newsletter modal`) so the transcript can say
it in one line, and it never clicks anything consequential. Vendor-specific banners go in a
data table (selectors and button labels per CMP: OneTrust, Didomi, Cookiebot, Usercentrics,
Quantcast, TrustArc, Sourcepoint) that tests cover with fixtures.

## 4. Bot checks: try, then hand off (blocked is not failed)

`checkpoint()` detects a challenge page or widget (Cloudflare "checking your browser" and
Turnstile, reCAPTCHA, hCaptcha, "press and hold", image and text challenges, rate-limit and
access-denied pages) and returns `{ kind, attempt }`. The run stays agentic through it:

1. **Wait and settle.** Many interstitials pass on their own within a few seconds in a real
   browser. Our WebKit browser is the person's own real browser profile, our strongest signal.
2. **Attempt it, up to three times.** The agent works the challenge as a person would, with the
   page and the vision fallback (section 5): checkbox clicks through native input, press and hold,
   reading a distorted text or picking tiles from the marked screenshot. Between attempts it
   reloads or settles. Each attempt is one line in the transcript.
3. **Hand off only when three attempts fail** (or the challenge needs the person, such as a code
   sent to their phone). `requestUser(reason)` pauses the run, hands the page over with Take over,
   and the run resumes after, re-reading the page. This shows as "Waiting for you", not as a
   failure.
4. **If the person is not there** (a scheduled run), the run waits on the page, then ends as
   blocked with the page kept as proof, still not a failure, and says what it needs.
5. **Route around** only when the answer can come from another source without the blocked page.

The agent never forwards a challenge's token to a third party solver.

## 5. Vision as a fallback

- `tab.screenshot({ region?, marks? })` returns a JPEG (about 30 KB, like the PiP pictures) and,
  with `marks`, draws a numbered box on each interactable element (refs from the same read), so
  the model can say "box 14" and the program clicks that ref.
- **Automatic triggers**: `read` returns `thin: true` (few interactable elements for the page's
  size, or text length far below the document's), or the same action fails twice. The harness
  then attaches a marked screenshot to the next result, once per page state.
- **A per-run cap** (default 12 images), counted in the run's budget and shown in the journal.
- **Model**: the run's own model when it takes images; otherwise a vision-capable model is used
  just for the marked screenshot and returns a description plus box ids. The existing
  `screenAct` (Midscene, coordinates) stays for the desktop and Misty-window surfaces; the
  browser fallback is ref-based, which is more reliable than coordinates.
- Pixel clicking (`clickAt(x, y)`) exists only as a last resort when a marked box cannot be
  produced (canvas), and counts as consequential-checked like any click.

## 6. Light human-likeness

- Scrolling in about 80% of the viewport with a short settle between steps (never `scrollTo`
  jumps on pages with lazy content); `loadAll` uses the same.
- Typing with the page's real key events at a normal rate, only where a site validates per key
  (otherwise `fill`).
- A 150 to 400 ms pause before a click that follows a scroll or a navigation; hover before a
  click on menus.
- None of this on pages that do not block, so the common path stays fast. The ladder in 4 turns
  on slower timing for a site only after a block.

## 7. Real input and the cursor

An agent should be able to do anything a person does with a mouse and keyboard, and the person
watching should see each action happen.

- **Real input, where the page can tell.** Hover, wheel scrolling and typing go through native
  events into the page's own view, as `MistyBrowserInput.m` does for clicks. Scripted DOM events
  don't trigger CSS `:hover`, wheel-driven loading or keystroke autocomplete. Scripts stay the
  fallback for frames and pages where native input can't land.
- **Element first, point second.** Actions name a ref or a locator; a point (normalized 0 to 1) is
  for canvases, maps and controls with no ref.
- **The gates stay.** Paying, sending, deleting, posting and signing up stop where they stop
  today, whatever action reaches them.

Gaps to close, in order:

1. Native `hover`, wheel `scroll` at a point inside a panel, and key-by-key `type` at a human pace
   for autocomplete and editors (`fill` stays for setting a value at once).
2. `drag` from a ref or point to a ref or point (sliders, sortable lists, maps); `back`,
   `forward` and `reload`; a click that opens a link in another tab of the agent's own.
3. Page dialogs in the page layer: `alert` is read and closed, `confirm` and `prompt` are answered
   the safe way (cancel) unless the step asked for one, and the text goes back in the result; a
   leave-page dialog stays for the agent to decide. Permission prompts are denied by default;
   HTTP sign-in dialogs go to the person.
4. Text selection with copy and paste on the agent's own clipboard (never the person's); media
   play, pause, seek and mute; triple and middle clicks, long press and held modifiers.

**The cursor.** One cursor per agent tab (`browser_agent_cursor.js`), white with a dark edge. It
glides 320 ms to each target (instantly under Reduce motion), pulses where it presses, and follows
every pointer action: move, click, drag along its path, scroll where the wheel turns, focus before
typing. It is drawn inside the page, stays out of the agent's snapshots and hides when the person
takes over.

Checks: a CSS hover menu opens, a lazy feed loads on wheel, a search box shows suggestions, a
sortable list and a range slider move, `alert` and `confirm` are answered and reported, history
moves back and forward, and the cursor is visible at each step.

## 8. Completion and errors

Unchanged from the harness (kept tabs awake, counts met, sources visited), plus: a run that ended
at a challenge, login wall or block says so in its answer, with the page that blocked it kept as
proof, instead of a vague "could not complete".

## 9. The benchmark package

Today the evals sit under `server/apps/agent-runtime/evals/` (odysseys, code, voice, pointing,
free-model), run with vitest, and reach the desktop through a debug-only bridge.
They share a judge, spend and watchdog code and are tied to the runtime's package. Split them:

```
benchmarks/                 own package.json, own tsconfig, no import from src/ or server/
  core/                     task and run types, judge interface, spend and watchdog, reports
  adapters/
    misty/                  runs a task through the desktop bridge (today's browser eval bridge)
    ...                     one adapter per outside harness, for comparison runs
  suites/
    obstacles/              new: fixtures and live pages (below)
    odysseys/               moved from evals/odysseys
    online-mind2web/        later
    webvoyager/             later
    bu-bench-v1/            later; researched when we add it
  reports/                  git-ignored, as today
```

- The package depends on Misty only through the bridge and the public model routing, so a suite
  can also run against another agent for comparison.
- Each suite declares its tasks, a judge (rubric, deterministic check, or both), and a cost cap.
  The three tiers in the harness plan (iterate on Nemotron, check with an official judge, report) stay.
- The repo's runtime-specific evals that are not browser (code, voice, pointing, free-model) move
  later or stay; Odysseys moves first.
- Local checks stay local (no CI), run from the Mac like releases.

### The obstacles suite (new)

Fixture pages served locally, so runs are repeatable, each with a deterministic pass check:

| Fixture | What it tests |
|---|---|
| cookie-walls | Eight CMP styles, one blocking scroll, one in a shadow root, one in an iframe |
| modal-stack | Newsletter, app install and promo modals appearing after a delay and on scroll |
| lazy-list | Infinite scroll with 200 rows and animated reveal; task needs row 150 |
| animated-hero | Tree empty until a transition ends; content appears on scroll |
| sticky-covers | Sticky headers and chat widgets covering targets |
| login-wall | Blocked content behind a login; the right answer is a hand off or a clear report |
| bot-check | A local challenge page that passes after waiting or one honest interaction, and one that needs the person |
| canvas-widget | A control with no tree (forces the vision fallback) |

Plus a small live set of public pages with known banners, run by hand (not a gate).

## Phases

0. **The prompt.** Split limits from how-to and ablate the how-to (above). It runs first on
   the existing Odysseys tasks and again on the obstacles suite once phase 1 builds it, because it
   changes every later baseline.
1. **Benchmark package.** Create `benchmarks/`, move Odysseys, keep their commands
   working, add the obstacles suite with its fixtures and no new agent behavior, so we have a
   baseline before changing anything.
2. **Catalog and `settle`.** The generated catalog, `settle`, `thin`, `scrollUntil`, `loadAll`,
   plain scroll steps. Re-run the baseline.
3. **`clearObstacles` and `checkpoint`.** The CMP table, modal rules, the bot-check ladder and
   the hand off. Re-run.
4. **Vision fallback.** `screenshot`, marks, the triggers and the cap. Re-run.
5. **Outside suites.** Online-Mind2Web, WebVoyager, BU Bench V1 adapters.

Every phase ends with a before and after on the obstacles suite and the three Odysseys tasks.

## Risks

- Settling can hide a real page that never stops (video, live tickers): the 3 second cap and
  `settled: false` keep it honest.
- Closing a modal can lose what the person wanted (a "subscribe" modal that is the page's task).
  `clearObstacles` only closes what covers the viewport and is not inside the task's target.
- A bot-check hand off needs the person present; a scheduled run with nobody there ends as
  "blocked", with the proof tab.
- Vision on pages with sensitive data sends a screenshot to the model gateway, the same trust as
  page text today; the cap and the journal keep it visible.
