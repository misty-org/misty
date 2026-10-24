# Browser comparison

Misty compared with the browsers people choose and love: the AI browsers (Comet, Polar, Aside, Dia) and the ones people switch to for craft, privacy or freedom (Zen, Arc, Helium, Brave). Assistant apps and agents that aren't browsers (ChatGPT, Claude, Chrome with Gemini, Muse, Dots, Grok Bot) are not in this ledger (decided 2026-10-23).

Comet, Polar and Dia were re-researched 2026-10-11 from each company's own website, help center, pricing page and changelog; the first pass leaned on third-party reviews and got several cells wrong (Comet's encrypted sync, schedules and helper agents; Dia's Windows build, ad blocking and SOC 2). Aside, Zen, Arc, Helium and Brave were added 2026-10-23 from their own sites, help centers and GitHub repositories. Zen, Arc and Helium describe no agent or AI, so they sit only in the platform, browser and pricing tables; Brave is in the agent and model tables for Leo.

Rules for this doc:
- Competitor cells come only from the vendor's own pages, linked in Sources. A cell marked † still rests on a third-party source, or on an inference the vendor's pages don't state, and needs the vendor page before it is published.
- Nothing learned from opening their app bundles goes in here.
- Misty's column comes from the code. Cells marked _verify_ need a check in the shipped build.

Legend: ✓ has it · ◐ partial or limited · ✗ doesn't have it · ? the vendor doesn't say

## Who's in the chart

| Product | What it is (from its own site) |
| --- | --- |
| **Comet** (Perplexity) | Chromium browser on Mac, Windows, iPhone and Android. The browser agent (Comet Assistant) needs a paid Perplexity plan. Comes with the wider Perplexity system: Computer (a cloud agent with sub-agents, scheduled Automations, Brain memory, Portable Computer on NVIDIA hardware) and a desktop app that drives Comet and Mac apps. |
| **Polar** (Recursive Intelligence) | Chromium browser for long-running agent work, built by ex-Comet engineers. Launched 2026-07-29 after "Composer". Credit-based. 260+ templates, schedules, teams of agents. |
| **Aside** (Aside Computer, YC) | Browser on macOS and Windows "rebuilt for people and agents", on Chromium going by its changelog (first release 2026-05-27). The agent signs in through its own password manager (Aside Vault) and works on logged-in sites "without setting up integrations". Bring your own ChatGPT or Claude subscription or API key. Claims #1 on Online-Mind2Web, BU-Bench-V1 and Odysseys, the benchmark Misty targets (self-reported; the 99.0% shown doesn't say which benchmark). |
| **Dia** (The Browser Company, Atlassian) | Chromium browser on Mac and Windows. Free plan is a browser with no AI; AI starts at Better Answers. Skills, ~20 connected apps, Morning Brief, decks. |
| **Zen** | Free, open-source (MPL-2.0) browser "derived from Firefox" on macOS, Windows and Linux, still in beta. Workspaces with containers, split view, Glance link previews, compact mode and Zen Mods. Sync is Firefox Sync with a Mozilla Account. No mobile apps planned and no Widevine DRM yet. Funded by donations; 45k GitHub stars. |
| **Arc** (The Browser Company) | Retiring: it gets basic updates until it stops working on 2026-12-22, and its own page says "Dia is replacing Arc". Arc Search's AI and sync on iPhone and Android end 2026-11-23. Arc's Spaces become Dia's Profiles on import, with pinned tabs, favorites, passwords and extensions. |
| **Helium** (imput) | Free, open-source (GPL-3.0) Chromium browser "with all Google service dependencies removed", desktop only, in beta. Blocks ads, trackers and cookie banners by default, runs all Chromium extensions, 13,000+ local bangs, "no analytics". No password manager and no sync yet. Crowdfunded; 22k GitHub stars. |
| **Brave** | Free Chromium browser on every desktop and mobile platform; its own code is open source (MPL-2.0). Shields block ads, trackers and fingerprinting. Leo is a free AI assistant with no account, more models on Premium, and your own local or remote models. Sync uses client-side encryption. Earns from Search, opt-in Rewards ads, Firewall + VPN and Leo Premium subscriptions, and Brave Origin ($59.99 once). |

Edge, Opera Neon, Vivaldi and Orion were not checked against their own sites and are out of this version.

## Comparison chart

### Platforms

| | Misty | Comet | Polar | Aside | Dia | Zen | Arc | Helium | Brave |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| macOS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Windows | ✓ | ✓ | ◐ home page says yes, blog says macOS-only | ✓ native ARM installer since 2026-10-20 | ✓ | ✓ including ARM64 | ✓ | ✓ | ✓ |
| Linux | ✗ _verify_ | ? | ? | ✗ download page lists macOS and Windows only | ✗ macOS and Windows | ✓ including Flathub | ✗ | ✓ | ✓ |
| iPhone and Android | ✗ | ✓ | ✗ | ✗ download page lists macOS and Windows only | ✗ (Handoff from iPhone only) | ✗ none planned | ◐ Arc Search; its AI turns off 2026-11-23 | ✗ desktop only | ✓ |
| Engine | System WebKit / WebView2 | Chromium | Chromium | Chromium (the changelog names Chromium profiles and Chromium's extensions page) | Chromium | Firefox | Chromium † | Chromium with Google's services removed | Chromium |
| Chrome Web Store extensions | ✗ in progress | ✓ | ? | ✓ | ✓ | — Firefox add-ons instead | ✓ they move to Dia on import | ✓ all Chromium extensions; store requests anonymized | ✓ |
| App size on macOS | 41 MB | 716 MB | 431 MB (196 MB download) | ? | ? | ? | ? | ? | ? |

### Agent

| | Misty | Comet | Polar | Aside | Dia | Brave |
| --- | --- | --- | --- | --- | --- | --- |
| Agent acts in your signed-in tabs | ✓ | ✓ paid plans | ✓ | ✓ signs in through its Vault's autofill | ? "agent sessions", no detail | ? Leo works "without leaving the tab"; acting on sites isn't described |
| Agent on the free plan | ✓ | ✗ | ✓ 3,000 credits + 100/day | ✓ 500 credits a month | ✗ free plan has no AI | ? Leo is free; no agent described |
| Several tasks at once | ✓ | ✓ "as many errands in parallel as you want" | ✓ "run ten at the same time" | ✓ tasks in a Project find and message each other | ? | ? |
| Long tasks (hours) | ◐ Goal mode _verify_ | ✓ Computer | ✓ 15+ hours | ? Ultrabrowse (Pro) "keeps working until it's done", no duration given | ? | ? |
| Helper agents (sub-agents) | ✓ | ✓ Computer | ✓ "team of agents" | ✓ each with its own model | ✗ | ? |
| Saved prompts and templates | ✓ 22 templates | ✓ Shortcuts, default set | ✓ 260+ templates | ✓ Skills, a skill creator and a CLI; no templates | ✓ Skills and Skills gallery | ? |
| Scheduled tasks | ◐ cloud workflows only | ✓ Automations, hourly and up | ✓ hourly to custom | ✓ Routines: monthly, custom and event-triggered; 3 on Free | ✗ | ? |
| Scheduled tasks that drive a browser | ✗ | ✓ "attended" runs | ✓ | ◐ Routines run as agent tasks; browser use not stated † | ✗ | ? |
| Works in desktop apps, not just the browser | ◐ _verify_ agents at the cursor | ✓ desktop app drives Mail, Finder, Slack, Messages, Notes (Mac) | ✗ | ✓ Computer Use (Mac and Windows), Max only, since 2026-10-23 | ✗ | ? |
| Block the agent on chosen sites | ◐ site blocks in the page runtime, no setting | ✓ | ? | ? | ✓ MDM | ? |
| Memory | ◐ only what you ask it to remember | ✓ plus Brain (Max) | ✓ | ✓ built from browsing history, kept on the device | ✗ phased out | ✓ preferences across chats; history kept on the device |
| Voice | ✓ | ✓ 36 languages, 10 voices | ? | ✓ dictation | ✓ dictation | ? |
| Writing help on any selected text | ◐ Journal notes only | ✓ Inline Assistant | ? | ? | ? | ◐ summarize, generate and translate in the tab |
| Create decks, docs and reports | ✗ | ✓ Create files and apps | ? | ◐ works with documents and spreadsheets on your computer | ✓ Decks | ? |
| Send the agent a task by email or Slack | ✗ | ✓ Computer in Email, Slack | ✗ | ✓ Channels: Slack, Telegram, Discord (Pro) | ✗ | ? |
| Connected apps | ✓ Composio | ✓ ~25 connectors plus MCP | ✓ connectors | ✓ MCP connectors | ✓ ~20 apps | ? |

### Models

| | Misty | Comet | Polar | Aside | Dia | Brave |
| --- | --- | --- | --- | --- | --- | --- |
| Choose the model | ✓ paid plans | ✓ paid plans | ✗ mixes models for you | ✓ plus your own ChatGPT or Claude subscription, or an API key | ✗ GPT-5 for everything | ✓ more models on Premium |
| Makers to choose from | About 30 through the AI Gateway (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Qwen, Moonshot…) | 8: Perplexity, OpenAI, Anthropic, Google, xAI, Moonshot, Z.ai, NVIDIA | — | Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot, Z.ai, Meta, Xiaomi, plus OpenRouter | — | Mistral (Mixtral), Anthropic, Meta, plus your own |
| Flagship models on the first paid plan | ✓ | ✗ GPT-5.6 Sol and Claude Opus 5 are Max-only | — | ✓ GPT-5.6 Sol is Pro's default | — | ? |
| A different model for thinking, seeing, listening and speaking | ✓ | ✗ | ✗ | ◐ a chosen model per sub-agent | ✗ | ? |
| Ask several models at once and merge answers | ✗ | ✓ Model Council (Max) | ✗ | ? | ✗ | ? |
| Run the agent on your own hardware | ✗ | ✓ Portable Computer (NVIDIA) | ✗ | ? home page shows an unexplained "Local" mode | ✗ | ✓ your own local or remote models |

### Working together

| | Misty | Comet | Polar | Aside | Dia |
| --- | --- | --- | --- | --- | --- |
| Shared workspace with notes, tasks and files | ✓ Spaces | ◐ shared Projects (Enterprise) | ◐ team billing, pooled credits | ◐ shared profiles and vaults (Enterprise) | ✗ |
| Your agent asks a teammate's agent | ✓ | ✗ | ✗ | ◐ only between tasks in one account | ✗ |
| Team plan | ✗ | ✓ Enterprise Pro from $40/seat | ✓ Teams $50/seat | ✓ Enterprise, contact sales | ✓ Dia for Work |

### Browser, sync and privacy

| | Misty | Comet | Polar | Aside | Dia | Zen | Arc | Helium | Brave |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open source | ✗ the desktop app is planned (C17) | ? | ? | ? | ? | ✓ MPL-2.0 | ? | ✓ GPL-3.0 | ✓ MPL-2.0 |
| Browse without an account | ✗ the welcome screen asks you to sign in first | ? | ? | ? | ? Arc import happens during sign-up | ✓ an account only for sync † | ? | ? no account mentioned; "No data collection" | ✓ even Leo needs no account; Premium does |
| Vertical tabs | ✓ left or right | ? | ? | ? | ✓ Sidebar tabs | ? | ✓ | ✓ four layouts | ✓ |
| Switchable tab sets (Spaces, Workspaces) | ✓ Spaces you share with people, with chat, notes, files, code and memory | ? | ? | ◐ Chromium profiles | ✓ Profiles (Arc's Spaces) | ✓ Workspaces with containers | ✓ Spaces, for one person | ? | ? |
| Split view | ✓ any layout, saved presets | ✓ two tabs | ? | ? | ✓ remembers layouts | ✓ | ✓ | ✓ | ✓ two tabs |
| Profiles with separate sign-ins | ✓ | ✓ | ? | ✓ Chromium profiles | ✓ swipe between | ✓ Firefox profiles | ? its Spaces become Dia's Profiles | ? | ? |
| Pinned tabs and favorites | ✓ | ? | ? | ? | ✓ Arc-style | ? | ✓ | ? | ✓ pinned tabs |
| Tab sleeping | ✓ | ? | ? | ? | ✓ | ? | ? | ? | ? |
| End-to-end encrypted sync | ✓ | ✓ passphrase; bookmarks, passwords, autofill, history, extensions, tabs | ? | ◐ cloud sync with recovery; end-to-end encryption stated for the Vault | ✓ | ◐ Firefox Sync with a Mozilla Account; encryption not stated | ? Arc Search sync ends 2026-11-23 | ✗ "Not yet" | ✓ client-side encryption |
| Website sign-ins carry over between your computers | ✓ some sites ask again | ✗ not in its synced types | ? | ? Enterprise gives agents company cookies and browser state | ✗ not in its synced types | ? | ? | ✗ no sync | ? |
| Built-in ad and tracker blocking | ✗ by extension, such as uBlock Origin Lite | ✓ | ? | ✓ default filter lists, on at setup | ✓ | ? | ? | ✓ ads, trackers and cookie banners by default | ✓ Shields |
| Password manager | ✓ | ✓ | ? | ✓ Aside Vault, Secure Enclave keys | ✓ | ◐ passwords through Firefox Sync | ✓ passwords move to Dia | ✗ none built in | ✓ |
| Import from other browsers | ✓ including sign-ins | ✓ including passwords | ? | ✓ plus 1Password, Proton Pass, NordPass and Apple Passwords | ✓ | ? | ? | ✓ | ✓ bookmarks and settings |
| Cross-device clipboard | ◐ built, not shipped | ✗ | ✗ | ? | ✗ | ? | ? | ? | ? |

### Pricing

| | Misty | Comet | Polar | Aside | Dia | Zen | Arc | Helium | Brave |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Free plan | Every feature, one fast model | Browser and search; no browser agent | 3,000 credits, +100 a day | 500 credits a month, 3 routines, your own subscription | Browser only, no AI | The whole browser; donations | The whole browser, until 2026-12-22 | The whole browser; crowdfunded | The whole browser, Shields and Leo |
| First paid plan | $12 Pro | Pro, $20 † | $20 | $20 Pro (20% off yearly) | Better Answers, $20 (the plans page also shows $10 on the card) | — | — | — | Leo Premium (no price on its page); Firewall + VPN |
| Top individual plan | $200 Ultra+ | Max, $200 † | Pro+ / Max | $200 Max | Better Days, $100 | — | — | — | Brave Origin, $59.99 once |

## What Misty can lead with

- **Spaces are places you share, not tab sets.** Arc's Spaces (now Dia's Profiles) and Zen's Workspaces sort one person's tabs. A Misty Space has its people and their agents, a chat, notes, drawings, files, code and a memory, and every window takes its Space's color. This is the strongest lead against the browsers people love, and Arc users need a new home before 2026-12-22.
- **Website sign-ins carry over between your computers.** Comet and Dia sync passwords and tabs, not sessions, and Helium has no sync. Recheck Polar, Aside, Zen and Brave before publishing; Aside's Enterprise plan gives agents company cookies and browser state.
- **The agent is on the free plan.** Comet and Dia put their browser agent behind a paid plan; Polar gives daily credits and Aside 500 credits a month. Brave's Leo is free but isn't described acting on sites.
- **A different model for each job**, from about 30 makers. Comet offers 8 makers and keeps its flagships for Max; Polar and Dia don't let you choose. Don't lead on maker count against Aside (about ten makers plus OpenRouter, a model per sub-agent, your own subscription or key) or Brave (your own local or remote models).
- **Flagship models from $12.** Comet's top models need Max; Aside's Pro is $20.
- **Agents that ask a teammate's agent**, inside a shared Space. Aside's tasks message each other only within one account.
- **41 MB on the system engine** against 431–716 MB for Comet and Polar on Chromium.

Not leads yet, because the browsers people love win them today: open source (Zen, Helium, Brave), browsing without an account (Zen, Brave) and built-in ad blocking (Helium, Brave, Aside). C16 and C17 close the first two; ad blocking stays an extension (see Out of scope).

Claims that no longer hold and must not be used: "Comet has no scheduled tasks or helper agents", "Dia is Mac-only", "Dia has no ad blocking", "only Misty has end-to-end encrypted sync", "background agents only on Comet's $200 plan".

## Parity plan

Goal: Misty has everything the others have, so no public row shows Misty losing. A row stays off the website until its gap ships.

| ID | Gap | Who has it | What Misty already has | Size | Order |
| --- | --- | --- | --- | --- | --- |
| C1 | Scheduled tasks that drive the browser | Comet, Polar, Aside † | Cloud schedules; keep-awake and device pick (Phase 6) | M | 1 |
| C2 | Agent stops before paying, sending, deleting or posting | Polar, Comet ("no approvals needed" is opt-out), Aside (payments, posts and messages wait for you) | Nothing since approvals were retired 2026-10-04; needs a narrow design | M | 2 |
| C3 | Template library: rewrite in Misty's own words and grow toward Polar's 260+ | Polar, Comet, Dia, Aside (Skills) | 22 templates, but their names closely match Polar's (see note) | M | 3 |
| C4 | Writing help on any selected text on a web page | Comet | `AiSelectionMenu` in Journal notes | S | 4 |
| C5 | Block the agent on chosen sites, as a setting | Comet, Dia | Site blocks exist in the page runtime | S | 5 |
| C6 | Ask several models at once and merge the answers | Comet (Max) | Model breadth already there; a natural fit | M | 6 |
| C7 | Create decks, docs and reports as files | Comet, Dia | Journal for notes; no file output | L | 7 |
| C8 | Send the agent a task by email or Slack | Comet, Aside (Slack, Telegram, Discord) | Composio Gmail and Slack | M | 8 |
| C9 | Ship the cross-device clipboard; confirm agents at the cursor | Misty-only rows | Built | S | 9 |
| C10 | Some model choice on the free plan | — (lead, not parity) | One fast model on Basic | S | 10 |
| C12 | Chrome Web Store extensions | Comet, Dia, Aside, Arc, Helium, Brave (Zen takes Firefox add-ons) | In progress through Kiri | L | 12 |
| C13 | Extensions on Windows | Comet, Dia, Aside, Zen, Arc, Helium, Brave | MV3 only on WebView2, with gaps (`windows-limits.md`) | L | 13 |
| C14 | iPhone and Android | Comet, Brave, Arc (Arc Search) | No mobile client | XL | 14 |
| C15 | Run the agent on your own hardware | Comet, Brave (your own models) | Browser work already runs on your device; models don't | XL | later |
| C16 | Browse with no account; sign in only for sync, Spaces and AI | Zen, Brave | Approved brief `docs/design/no-account-browsing/BRIEF.md`; all four phases written 2026-10-23, not yet built, tested or released | M | next |
| C17 | Open-source desktop app; sync, the agent runtime and Spaces stay proprietary, with the server and billing | Zen, Helium, Brave | Kura is already open source. Sync (`src-tauri/crates/browser-sync`), the on-device agent (page agent, `browser_run`) and Spaces (`src/features/spaces`) live in the desktop app today, so they move behind a closed module before the rest is published. Pick a license and trademark policy; scrub secrets from history | L | next |

**Out of scope:** SOC 2 and other enterprise compliance, SSO, SCIM and MDM. Misty is not pursuing enterprise customers, so these never go on the chart or in the parity plan. Team plans are also out (2026-10-11): Misty is a consumer app, so the "Team plan" row stays off the website. C11 was removed, and C12–C17 keep their IDs. C18 (bringing over Arc's Spaces, pinned tabs and favorites) was dropped on 2026-10-23: Arc users get bookmarks, history, sign-ins and extensions through the normal Chromium import, and Arc's sidebar doesn't come across. Built-in ad blocking stays out (decided 2026-10-12): onboarding offers a store extension such as uBlock Origin Lite, and Misty ships no blocking code or lists of its own.

**Template wording.** Misty's 22 templates in `src/features/agents/workspace/taskTemplates.ts` use the same category set as Polar's gallery and near-identical titles ("Turn a listing page into a spreadsheet" vs Polar's "Turn any listing page into a spreadsheet", "Draft replies to messages waiting on me" vs "Draft replies to emails waiting on me", "Find the best price for an item" vs "Find the best price for this exact item"). Before a public page names Polar, rewrite these in Misty's own words.

## Website rules for this chart

- Six competitor columns at most, chosen from Zen, Arc, Helium, Brave, Dia, Comet, Polar and Aside. Drop Arc once it stops working on 2026-12-22.
- Publish only rows where every cell is ✓ or ✗ from the vendor's own page; drop rows with ? or †.
- No "where others are ahead" section; gaps close through the parity plan.
- Plain-text names, no logos or app screenshots. "Compared October 2026" with links to each vendor page.
- Recheck before every release; these products change weekly.

## Sources (vendor pages, read 2026-10-11 unless marked)

- Comet and Perplexity: [Comet](https://www.perplexity.ai/comet), [Getting started](https://www.perplexity.ai/help-center/en/articles/11172798-getting-started-with-comet), [Shortcuts](https://www.perplexity.ai/help-center/en/articles/11897890-comet-shortcuts), [Scheduled Tasks in Computer](https://www.perplexity.ai/help-center/en/articles/11521526-perplexity-tasks), [What is Computer](https://www.perplexity.ai/help-center/en/articles/13837784-what-is-computer), [Work with browsers and apps](https://www.perplexity.ai/help-center/en/articles/19800006-work-with-browsers-and-apps), [Plans](https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you), [Max](https://www.perplexity.ai/help-center/en/articles/11680686-perplexity-max), [Models by plan](https://www.perplexity.ai/help-center/en/articles/10354919-what-advanced-ai-models-are-included-in-my-subscription), [Connectors](https://www.perplexity.ai/help-center/en/collections/18799295-connectors-integrations), Comet help: [Sync](https://www.perplexity.ai/help-center/comet/en/articles/12569908-sync-between-devices), [Split view](https://www.perplexity.ai/help-center/comet/en/articles/12324462-split-view-mode), [Profiles](https://www.perplexity.ai/help-center/comet/en/articles/11642916-profiles-on-comet), [Assistant panel](https://www.perplexity.ai/help-center/comet/en/articles/11734688-assistant-panel), [Control what the Assistant can use](https://www.perplexity.ai/help-center/comet/en/articles/12658082-control-what-comet-assistant-can-use), [Memory](https://www.perplexity.ai/help-center/comet/en/articles/12658438-comet-memory), [Inline Assistant](https://www.perplexity.ai/help-center/comet/en/articles/13533742-inline-assistant), [Voice](https://www.perplexity.ai/help-center/comet/en/articles/13860420-voice-mode), [Extensions](https://www.perplexity.ai/help-center/comet/en/articles/11734716-extensions)
- Polar: [Home](https://polarbrowser.com), [Pricing](https://polarbrowser.com/pricing), [Templates](https://polarbrowser.com/templates), [Introducing Polar](https://polarbrowser.com/blog/introducing-polar), [Blog](https://polarbrowser.com/blog), [Trust center](https://trust.polarbrowser.com/)
- Dia: [Home](https://www.diabrowser.com), [Plans](https://www.diabrowser.com/plans), [For Work](https://www.diabrowser.com/forwork), [Apps](https://www.diabrowser.com/apps), [Changelog](https://www.diabrowser.com/changelog), [1.52.0](https://www.diabrowser.com/changelog/mac/1-52-0)
- Aside (read 2026-10-23): [Home](https://aside.com), [Pricing](https://aside.com/pricing), [Download](https://aside.com/download), [Browser agent](https://aside.com/features/browser-agent), [Changelog](https://docs.aside.com/changelog/components)
- Zen (read 2026-10-23): [Home](https://zen-browser.app), [Download](https://zen-browser.app/download), [User manual](https://docs.zen-browser.app/user-manual), [FAQ](https://docs.zen-browser.app/faq), [GitHub](https://github.com/zen-browser/desktop)
- Arc (read 2026-10-23): [Home and farewell](https://arc.net). The [Help Center](https://resources.arc.net) now lists only release notes.
- Helium (read 2026-10-23): [Home](https://helium.computer), [GitHub](https://github.com/imputnet/helium)
- Brave (read 2026-10-23): [Home](https://brave.com), [Leo](https://brave.com/leo/), [Features](https://support.brave.app/hc/en-us/articles/15872271230221), [GitHub](https://github.com/brave/brave-browser)
- † still to confirm: Comet Pro and Max prices ([eesel](https://www.eesel.ai/blog/perplexity-comet-pricing)); Arc's engine (Chromium), which arc.net no longer states; that Zen needs an account only for sync
