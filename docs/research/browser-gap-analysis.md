# Browser gap analysis: Misty vs Zen, Dia, Arc

Researched 2026-10-22. Read-only pass over the code; nothing was run.

## How to read this

**Evidence limits.** I could not reach Reddit or Hacker News threads directly: search returned no HN threads, and the one Reddit mirror I tried would not load. The demand evidence below comes from blogs, news sites, comparison pages and changelogs that quote or summarize those communities. Several are vendor blogs (SupaSidebar, SigmaOS) or AI-generated pages (factually.co), so I treat their rankings as opinion. "Demand" is therefore a judgment from how many independent sources raise a feature and how strongly. It is not a count of Reddit posts. A pass with working Reddit access (r/ArcBrowser, r/zen_browser, r/diabrowser) would sharpen the order.

**Misty status** comes from reading code and docs, not from running the app.
- **Have**: implemented in code.
- **Partial**: exists but narrower than the competitor's version, or only on one OS.
- **Missing**: no code found.
- **Broken**: shipped but known not to work as users expect. Only extensions qualify, per the project's own docs.

**Biggest context:** Misty runs on the system webview (WKWebView on macOS, WebView2 on Windows), not Chromium or Gecko. That is its advantage (41 MB app, per `docs/competitors.md`) and the root of its extension and web-compat gaps.

## 1. What Arc refugees say they miss

Ordered by how consistently sources raise it.

1. **The vertical sidebar.** The most-cited loss. One quoted Reddit user: "I miss Arc's sidebar the most" ([SupaSidebar](https://supasidebar.com/blog/switching-from-arc-browser)). Dia launched without vertical tabs and later promised to bring them back ([TestingCatalog](https://www.testingcatalog.com/dia-browser-to-bring-back-vertical-tabs-in-upcoming-update.md)).
2. **Spaces / workspaces tied to profiles.** Dia's workspaces appeared quietly in July 2026 and were called its "most-requested feature"; the author had stopped using Dia without them ([Piunika Web](https://piunikaweb.com/2026/07/01/dia-most-requested-feature-finally-here/)). Zen's equivalent is "workspaces," but its Essentials work across all workspaces and can't use per-workspace accounts ([Remote Synthesis](https://remotesynthesis.com/blog/migrating-from-arc-to-zen/)).
3. **Little Arc / Peek windows.** The author of [Why I still use Arc](https://piunikaweb.com/2026/09/03/why-i-still-use-arc-browser/) says no alternative has it. Zen's Glance only fires for links in pinned tabs, not links from other apps ([Remote Synthesis](https://remotesynthesis.com/blog/migrating-from-arc-to-zen/)). Dia lacks it ([Piunika Web](https://piunikaweb.com/2026/10/13/arc-might-soon-be-abandoned-as-atlassian-pushes-users-towards-dia/)).
4. **Command bar (Cmd+T).** SupaSidebar's founder says no browser has a native equivalent ([SupaSidebar](https://supasidebar.com/blog/switching-from-arc-browser)). Vivaldi's F2 Quick Commands is the closest ([Supercharge](https://www.superchargebrowser.com/library/open-source-chromium-arc-like-browsers-2026.md)).
5. **Boosts.** Zen has a copy; Edge's "Remix" is similar but not the same ([Piunika Web](https://piunikaweb.com/2026/09/03/why-i-still-use-arc-browser/)).
6. **Split view.** Zen has a 4-pane version; Vivaldi has Tab Tiling up to four tabs ([Supercharge](https://www.superchargebrowser.com/library/open-source-chromium-arc-like-browsers-2026.md)).
7. **Auto-archive of idle tabs and Tidy / Clear.** Called out as having no native equivalent in major browsers ([SupaSidebar](https://supasidebar.com/blog/switching-from-arc-browser), [Piunika Web](https://piunikaweb.com/2026/09/03/why-i-still-use-arc-browser/)).
8. **Air Traffic Control** (route links to a Space by site). No alternative has it ([SupaSidebar](https://supasidebar.com/blog/switching-from-arc-browser)); the Zen migrator gave it up.
9. **Smaller Arc touches** named in migration write-ups: live GitHub folders, calendar meeting links, hover previews, instant dev tools on localhost ([Remote Synthesis](https://remotesynthesis.com/blog/migrating-from-arc-to-zen/)).
10. **Easels** (whiteboards). Mentioned as lost, with no browser replacement ([SupaSidebar](https://supasidebar.com/blog/switching-from-arc-browser), [DEV](https://dev.to/sidtalesara/arc-browser-is-dead-and-dia-isnt-the-answer-a-deeply-frustrated-honest-review-21e8)). Low weight.

**Why they leave Arc:** it is in maintenance mode since May 2025; The Browser Company says it has stopped building new Arc features and ships only security and Chromium updates ([Digital Trends / Genbeta roundup via search](https://www.genbeta.com/navegadores/arc-navegador-que-pretendia-revolucionar-sector-ha-muerto-tiene-sucesor-perfecto)). Atlassian completed its acquisition on 21 October 2025 and is steering Arc users to Dia ([Piunika Web](https://piunikaweb.com/2026/10/13/arc-might-soon-be-abandoned-as-atlassian-pushes-users-towards-dia/)).

**What they complain about in each destination**
- **Zen** (Firefox/Gecko, open source): no Chrome extensions, which is the main friction ([factually.co](https://factually.co/fact-checks/electronics-tech/zen-vs-other-browsers-1d8de7)); no Widevine/DRM on Windows and macOS, so Netflix, Spotify and Disney+ don't play ([Zen FAQ](https://docs.zen-browser.app/faq)); reports of choppy scrolling and high RAM on a Reddit thread ([r/zen_browser via mirror](https://redlib.ssps.io/r/zen_browser/comments/1l3qrs8/is_zen_supposed_to_be_this_slow)); occasional UI quirks and a small team.
- **Dia** (Chromium): "Chrome with ChatGPT layered on top," missing Spaces, vertical tabs, Easels, Boosts, command palette ([DEV](https://dev.to/sidtalesara/arc-browser-is-dead-and-dia-isnt-the-answer-a-deeply-frustrated-honest-review-21e8)); bugs that keep some from daily use, even on the Windows beta, which launched 2026-10-07 as an "early, untested build" ([Piunika Web](https://piunikaweb.com/2026/10/07/dia-browser-windows-launch/), [beta progress](https://piunikaweb.com/2026/08/13/dia-beta-progress-significant-tabs/)).
- **Vivaldi**: praised as the Chromium browser closest to Arc (vertical tabs, workspaces, F2 commands, Tab Tiling) but has no hover Peek and its UI is closed source ([Supercharge](https://www.superchargebrowser.com/library/open-source-chromium-arc-like-browsers-2026.md)).
- **Brave / Thorium**: weak for Arc users; Brave offers vertical tabs but no workspaces or command bar ([Supercharge](https://www.superchargebrowser.com/library/open-source-chromium-arc-like-browsers-2026.md)).
- **Chrome / Edge**: Chrome 146 (March 2026) added basic vertical tabs; Edge has had them for years in basic form. Chrome no longer runs full uBlock Origin ([SupaSidebar Chrome alternatives](https://supasidebar.com/blog/chrome-alternatives-2026)).

## 2. Feature inventory

Columns: **Z** Zen, **D** Dia, **A** Arc, **B** baselines (Vivaldi, Brave, Edge, Chrome; named where it matters). ✓ yes, ◐ partial, ✗ no, ? not established by my sources. **Demand**: H, M, L (judgment, see above).

### UI features

| Feature | Z | D | A | B | What users say | Demand | Misty | Evidence in Misty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vertical tab sidebar | ✓ | ◐ added late | ✓ | Vivaldi ✓, Brave ✓, Edge ✓ basic, Chrome ✓ basic | The top reason people chose Arc | H | **Have** | Tabs always in a left or right sidebar by design (`AGENTS.md`, `src/features/app-shell/dockingLayout.ts`) |
| Spaces / workspaces with separate logins | ✓ | ◐ new, July 2026 | ✓ | Vivaldi ✓ workspaces; others use profiles | Core need; Zen's Essentials don't follow per-space accounts | H | **Have** | A Space is a profile and a sync vault; windows switch Space in place; Space bar, color, Open in new window (`docs/spaces/as-profiles.md`, `src/features/spaces/`) |
| Command bar (⌘T) | ◐ | ✗ | ✓ | Vivaldi ✓ F2 | Lost on every Arc exit | H | **Have** | ⌘T panel opens URLs, searches, jumps to places, `!ask` / `@agent`, ⌘⏎ for split (`roadmap.md` §1; `src/features/browser/workspace/omnibox/`) |
| Split view | ✓ 4-pane | ✓ | ✓ | Vivaldi ✓ tiling, Chrome ✓, Edge ✓ | Valued; layout differences annoy | M | **Have** | Dock tree with any layout and saved presets (`src/features/workspace/dockTree.ts`, `BrowserPaneLayoutMenu.tsx`) |
| Peek / Little Arc / Glance | ✓ Glance, limited | ✗ | ✓ | ✗ | Habit-forming; the one thing no alternative copies fully | H | **Have** (verify trigger) | `PeekOverlay.tsx` with Keep and Close; external-link routing in `src/features/workspace/externalLinks.ts`. Check that links from other apps open as a peek, not only in-page links |
| Pinned tabs / Favorites | ✓ + Essentials | ✓ | ✓ | all ✓ | Per-profile favorites are the gap in Zen | M | **Have** | Pinned tabs (`pinnedUrl`) plus a Favorites tile strip leading the sidebar (`FavoritesStrip.tsx`, bookmark-backed, in the workspace store). Correction 2026-10-22: the first draft said there was no Favorites tier. Whether it is scoped per Space is unverified |
| Tab groups / folders | ✓ folders | ✓ | ✓ folders | Chrome ✓, Vivaldi stacks | Standard | M | **Have** | `TabGroupEditor.tsx`, group colors, sync (`browser-sync/tabGroupSync.ts`) |
| Auto-archive idle tabs | ◐ | ? | ✓ | ✗ native | Named as irreplaceable | M | **Have** | `workspace/tabArchive.ts`, Archived tabs page, hours setting |
| Tidy / Clear tabs | ✗ | ✗ | ✓ | ✗ | Niche but loved | L | **Missing** | No "tidy" code found |
| Boosts (per-site style, zap) | ✓ | ✗ | ✓ | Edge Remix ◐ | Copied by Zen; Dia dropped it | M | **Partial** | `SiteStyleDialog.tsx`: custom CSS, element hiding by picking, dark mode per site. No color/font pickers, no sharing or gallery |
| Easels / whiteboard | ✗ | ✗ | ✓ | ✗ | Missed, no replacement | L | **Partial** | Space Drawings (`src/features/journal/drawings/`) are a canvas but not tab-attached |
| Air Traffic Control (route links to Space) | ✗ | ✗ | ✓ | ✗ | Missed | M | **Partial** | "Open these sites in this Space" list (`SpaceSiteLinks.tsx`). Covers links from other apps, not in-browser routing rules |
| Sidebar auto-hide / compact mode | ✓ | ? | ✓ | Vivaldi ✓ | Common ask | M | **Have** | Space bar auto-hide, focus mode (`AGENTS.md`) |
| Themes / per-Space color | ✓ | ◐ | ✓ | Vivaldi ✓✓ | Quiet appeal | L | **Have** | `windowColors.ts`, night light, light/dark |
| Live folders (GitHub PRs), calendar, hover previews | ✗ | ✗ | ✓ | ✗ | Niche | L | **Missing** | None found |
| Media/Now Playing controls | ? | ? | ✓ | Edge/Chrome ✓ | Media tab copied widely | L | **Have** | `NowPlayingCard.tsx`, `docs/browser/media-controls.md` |
| Find in page, reader mode, translate | ✓ | ✓ | ✓ | all | Table stakes | M | **Have** | `BrowserFindBar.tsx`, `ReaderView.tsx`, `translatePage.ts` |
| Picture-in-picture | ✓ | ✓ | ✓ | all | Table stakes | M | **Have** | `pictureInPictureSettings.ts` and PiP commands |
| Dev tools (instant for localhost) | ✓ | ✓ | ✓ | all | Devs only | L | **Unknown** | Inspection code exists in the page runtime; I did not confirm a user-facing devtools entry |

### Functionality

| Feature | Z | D | A | B | What users say | Demand | Misty | Evidence in Misty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Extensions (Chrome Web Store)** | ✗ Firefox add-ons only | ✓ | ✓ | Chrome/Edge/Brave/Vivaldi ✓ | #1 Zen complaint; #1 blocker for any new engine | H | **Broken** on macOS and Windows (partial) | macOS: WKWebExtension plus a compat layer; `roadmap.md` §3 lists the top-20 install check as still open; comparison doc marks Chrome Web Store "in progress." Windows: MV3 only, static icon and title, popup can't be inspected, no `contextMenus`, `notifications` or permission prompts after install (`docs/browser/windows-limits.md`) |
| **Password manager** | ✓ Firefox | ✓ | ✓ | Chrome/Edge/Brave/Vivaldi ✓ | Expected; 1Password extension friction in Zen | H | **Partial** | Save prompt, fill list, Settings list/reveal/edit/delete, sealed in the sync vault (`passwords.rs`, `passwords.js`, `PasswordsSettings.tsx`). I found no generator, CSV import/export, passkeys, TOTP, breach check, or card/address autofill |
| Ad and tracker blocking | ◐ Firefox ETP | ✓ (Dia help center, per `ai-browser-comparison.md`) | ✗ (uBO ext) | Brave ✓ built in, Vivaldi ✓, Edge ✓ | Ranked a core privacy reason | H | **Missing** | No content blocker in `src-tauri/src` or settings. Relies on uBlock Origin Lite via extensions, itself unverified. Full uBlock Origin can't run on WebKit (`extensions/DESIGN.md`) |
| Encrypted sync (tabs, bookmarks, history, passwords) | ✓ Firefox Sync | ✓ | ◐ | Chrome ◐ passphrase | Expected | H | **Have** | `src/features/browser-sync/` (91 files), E2E vault; Misty also syncs website sign-ins |
| Import from other browsers | ✓ | ✓ | ✓ | all | Smooth Arc import is a draw | H | **Have** | `browser-import/` incl. history, sign-ins, extensions; Chrome 127+ sign-ins can't import on Windows |
| Profiles / containers | ✓ containers | ✓ | ✓ | all | Core to Arc users | H | **Have** | Spaces as profiles |
| Downloads manager | ✓ | ✓ | ✓ | all | Table stakes | M | **Have** | `DownloadsPage.tsx`, downloads store, Rust `downloads.rs` |
| History / bookmarks | ✓ | ✓ | ✓ | all | Table stakes | M | **Have** | `internal/HistoryPage.tsx`, `BookmarksPage.tsx` |
| Incognito / private | ✓ | ✓ | ✓ | all | Table stakes | M | **Have** | Incognito windows keep their Space color |
| DRM (Netflix, Spotify) | ✗ | ✓ | ✓ | all | Zen's biggest daily-use gap | M | **Unknown** | System webviews usually bring Widevine/FairPlay; not tested here |
| Performance / memory | ◐ complaints | ✓ praised for speed | ◐ crashes since freeze | Brave fast, Vivaldi heavy | RAM is a constant theme | H | **Have** (claim) | 41 MB app on system engines per `ai-browser-comparison.md`; no measurements read |
| Web compatibility | Gecko quirks | Chromium best | Chromium best | | Not named, but implicit | M | **Partial risk** | WebKit/WebView2 differ from Chromium; Kiri fills missing web APIs (`kiri/`) |
| Default browser, link handling | ✓ | ✓ | ✓ | all | Arc's Little Arc depends on it | M | **Have** | `deepLinks.ts`, external-link settings |
| Keyboard shortcuts, customization | ✓ | ✓ | ✓ | Vivaldi ✓✓ | Power users | M | **Have** | `src/features/shortcuts/` |
| AI features | ✗ | ✓ chat, Skills, Morning Brief | ◐ Max | Edge Copilot, Chrome Gemini | Dia's AI is called underwhelming; users want AI optional | M | **Have** | Agents, chat, voice, memory, teach mode (`src/features/agents/`, `roadmap.md`); free plan includes agent |
| Mobile | ✗ | iOS Handoff | ✓ iOS | all | Frequently requested | M | **Missing** | Explicit roadmap decision: no mobile in beta |
| Linux | ✓ | ✗ | ✗ | most | Zen draw | L | **Missing** | macOS and Windows only |

## Update 2026-10-22: built after this analysis

Not run in the app yet; typecheck, new unit tests and `cargo check` pass.
- Password generator, CSV import and export (Settings › Passwords).
- Clear tabs command (closes unpinned tabs except the active one).
- Boosts: font and text-size controls in the per-site Customize dialog.
- Ad and tracker blocking, **partial**: an in-page blocker (`scripts/adblock.js`) for known third-party hosts plus common ad-slot hiding, off by default (Settings › Browser). System webviews give no request-level hook, so a native content blocker is still the real fix.

## 3. Ranked gap table

Effort: S = days, M = 1-3 weeks, L = a month or more. Ranked by demand first, then low effort.

| # | Gap | Status | Demand | Effort | Why this rank |
| --- | --- | --- | --- | --- | --- |
| 1 | Extensions work on Chrome Web Store (verify and fix top 20) | Broken | H | L (macOS partly done; Windows large) | A browser without working uBlock Lite, 1Password or Bitwarden loses credibility. This is also the roadmap's own open item |
| 2 | Password manager completeness: generator, import/export CSV, card and address autofill, breach check | Partial | H | M | Each piece is small. Unlocks "I can leave my old browser." Passkeys and TOTP are the larger tail (L) |
| 3 | Built-in ad and tracker blocking | Missing | H | M | Expected by Brave, Dia, Edge, Vivaldi users; the system webviews support content rule lists. Removes dependence on item 1 for the most common extension |
| 4 | ~~Favorites / Essentials tier~~ | Have (corrected) | M | none | Exists as `FavoritesStrip`; only check per-Space scoping |
| 5 | Peek trigger audit: links from other apps and pinned tabs open as a peek | Have, verify | H | S | Cheap and a headline Arc feature; confirm behavior end to end |
| 6 | Air Traffic Control upgrade: in-browser site-to-Space routing rules | Partial | M | M | Already has the site list. Extend to rules and a prompt |
| 7 | Boosts: color and font pickers, share and import | Partial | M | M | CSS, zap and dark exist. A visual editor is what turns it into Boosts |
| 8 | Tidy / Clear tabs | Missing | L-M | S | Quick win; the agent can name groups |
| 9 | Command bar polish: recents, tab search, per-Space results, hover previews | Have | M | S-M | Table-stakes parity check against Vivaldi Quick Commands and Arc |
| 10 | Windows parity: extension limits, unrun voice/shell paths | Partial | M | L | Needed before pitching Windows users (Dia's Windows beta is also rough) |
| 11 | DRM check on both platforms | Unknown | M | S | Verify only; if it fails, it is a blocker |
| 12 | Easels attached to a Space tab | Partial | L | M | Space Drawings exist; low demand |
| 13 | Live folders, calendar links, hover previews | Missing | L | M-L | Nice-to-have signature touches |
| 14 | Mobile | Missing | M | L | Out of scope for the beta by roadmap decision |

## 4. Suggested order for closing gaps

1. **Peek audit (item 5).** One sitting. It checks the single most-missed Arc feature that Misty already claims.
2. **DRM check (item 11).** Also one sitting; avoids a surprise.
3. **Password manager quick items (item 2a).** Generator, CSV import/export, "Update password" polish. The separate session on passwords owns this, so coordinate rather than duplicate.
4. **Favorites per Space (item 4).** Small, and it answers Zen's best-known complaint.
5. **Ad and tracker blocking (item 3).** Native content rule lists, a per-site toggle in site info, and a counter. Largest single privacy win.
6. **Extensions (item 1).** Keep running in parallel with the above, since it is long. Work through `roadmap.md` §3's "top 20" list, publish a pass/fail table, and fix the biggest failures first. Windows after macOS is green.
7. **Tidy / Clear (item 8), then Air Traffic Control rules (6), then Boosts editor (7).** These three are the Arc signature touches that fit Misty's quiet, monochrome rules in `AGENTS.md`.
8. **Command bar polish (9)** and **Windows parity (10)** as ongoing work.
9. **Items 12-14** after the beta.

## 5. Where Misty already leads

From `docs/competitors.md` and the code:
- Spaces are profiles, sync vaults and an AI boundary at once; no listed competitor does the last part.
- Website sign-ins travel between computers; Dia's and Comet's sync does not carry sessions.
- Agent on the free plan; small app size on the system engine.
- Peek, split layouts, tab archive, per-site styles and a command panel are already built, so most of Arc's "irreplaceable" list is covered in code. The work now is verification and finish, not invention.

## Sources

- Arc status and migration: [Piunika Web, Arc might soon be abandoned](https://piunikaweb.com/2026/10/13/arc-might-soon-be-abandoned-as-atlassian-pushes-users-towards-dia/); [Piunika Web, why I still use Arc](https://piunikaweb.com/2026/09/03/why-i-still-use-arc-browser/); [Remote Synthesis, migrating from Arc to Zen](https://remotesynthesis.com/blog/migrating-from-arc-to-zen/); [SupaSidebar, switching from Arc](https://supasidebar.com/blog/switching-from-arc-browser); [Genbeta](https://www.genbeta.com/navegadores/arc-navegador-que-pretendia-revolucionar-sector-ha-muerto-tiene-sucesor-perfecto)
- Dia: [DEV, Arc is dead and Dia isn't the answer](https://dev.to/sidtalesara/arc-browser-is-dead-and-dia-isnt-the-answer-a-deeply-frustrated-honest-review-21e8); [Piunika Web, Spaces arrive](https://piunikaweb.com/2026/07/01/dia-most-requested-feature-finally-here/); [Piunika Web, Windows launch](https://piunikaweb.com/2026/10/07/dia-browser-windows-launch/); [Piunika Web, beta tabs](https://piunikaweb.com/2026/08/13/dia-beta-progress-significant-tabs/); [TestingCatalog, vertical tabs return](https://www.testingcatalog.com/dia-browser-to-bring-back-vertical-tabs-in-upcoming-update.md); [Wikipedia](https://en.wikipedia.org/wiki/Dia_(web_browser))
- Zen: [Zen FAQ](https://docs.zen-browser.app/faq); [factually.co comparison](https://factually.co/fact-checks/electronics-tech/zen-vs-other-browsers-1d8de7); [r/zen_browser thread via mirror](https://redlib.ssps.io/r/zen_browser/comments/1l3qrs8/is_zen_supposed_to_be_this_slow); [r/zen_browser, Zen vs Arc, via mirror](https://reddit.fabiomanganiello.com/r/zen_browser/comments/1fs47zi/zen_better_than_arc); [Neowin release notes](https://www.neowin.net/software/zen-browser-1185b/)
- Baselines and roundups: [Supercharge, Arc-like Chromium browsers](https://www.superchargebrowser.com/library/open-source-chromium-arc-like-browsers-2026.md); [SupaSidebar, Chrome alternatives](https://supasidebar.com/blog/chrome-alternatives-2026); [SigmaOS, Zen vs Arc](https://www.sigmabrowser.com/es/blog/zen-browser-vs-arc-which-browser-is-better-for-productivity-in-2026)
- Misty: `AGENTS.md`, `docs/spaces/as-profiles.md`, `docs/roadmap.md`, `docs/competitors.md`, `docs/browser/windows-limits.md`, `src/features/extensions/DESIGN.md`, plus the source files named in the tables.
