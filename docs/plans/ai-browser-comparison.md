# AI browser comparison

Misty compared with the AI browsers and assistant apps people weigh it against. Re-researched 2026-10-11 from each company's own website, help center, pricing page and changelog. The first pass leaned on third-party reviews and got several cells wrong (Comet's encrypted sync, schedules and helper agents; Dia's Windows build, ad blocking and SOC 2); this version replaces it.

Rules for this doc:
- Competitor cells come only from the vendor's own pages, linked in Sources. A cell marked † still rests on a third-party source and needs the vendor page before it is published.
- Nothing learned from opening their app bundles goes in here.
- Misty's column comes from the code. Cells marked _verify_ need a check in the shipped build.

Legend: ✓ has it · ◐ partial or limited · ✗ doesn't have it · ? the vendor doesn't say

## Who's in the chart

| Product | What it is (from its own site) |
| --- | --- |
| **Comet** (Perplexity) | Chromium browser on Mac, Windows, iPhone and Android. The browser agent (Comet Assistant) needs a paid Perplexity plan. Comes with the wider Perplexity system: Computer (a cloud agent with sub-agents, scheduled Automations, Brain memory, Portable Computer on NVIDIA hardware) and a desktop app that drives Comet and Mac apps. |
| **Polar** (Recursive Intelligence) | Chromium browser for long-running agent work, built by ex-Comet engineers. Launched 2026-07-29 after "Composer". Credit-based. 260+ templates, schedules, teams of agents. |
| **Dia** (The Browser Company, Atlassian) | Chromium browser on Mac and Windows. Free plan is a browser with no AI; AI starts at Better Answers. Skills, ~20 connected apps, Morning Brief, decks. |
| **Chrome with Gemini** (Google) | Gemini side panel; auto browse in preview for Google AI Pro and Ultra in the US. |
| **ChatGPT** (OpenAI) | Chat app with a built-in browser, ChatGPT Work, scheduled tasks (Plus) and Dot, an always-on agent (Pro). Atlas shut down 2026-08-09. |
| **Claude** (Anthropic) | Chat app; Claude in Chrome, scheduled tasks and Claude Code on Pro and up. |

Edge, Opera Neon and Brave were not re-checked against their own sites and are out of this version.

## Comparison chart

### Platforms

| | Misty | Comet | Polar | Dia | Chrome | ChatGPT | Claude |
| --- | --- | --- | --- | --- | --- | --- | --- |
| macOS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Windows | ✓ | ✓ | ◐ home page says yes, blog says macOS-only | ✓ | ✓ | ✓ | ✓ |
| iPhone and Android | ✗ | ✓ | ✗ | ✗ (Handoff from iPhone only) | ✓ | ✓ | ✓ |
| Engine | System WebKit / WebView2 | Chromium | Chromium | Chromium | Chromium | Built-in browser in the app | Your Chrome |
| Chrome Web Store extensions | ✗ in progress | ✓ | ? | ✓ | ✓ | ◐ in its built-in browser † | — |
| App size on macOS | 41 MB | 716 MB | 431 MB (196 MB download) | ? | ? | ? | ? |

### Agent

| | Misty | Comet | Polar | Dia | Chrome | ChatGPT | Claude |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Agent acts in your signed-in tabs | ✓ | ✓ paid plans | ✓ | ? "agent sessions", no detail | ✓ AI Pro/Ultra, US preview | ✓ | ✓ Claude in Chrome, Pro and up |
| Agent on the free plan | ✓ | ✗ | ✓ 3,000 credits + 100/day | ✗ free plan has no AI | ✗ | ◐ limited ChatGPT Work | ✗ |
| Several tasks at once | ✓ | ✓ "as many errands in parallel as you want" | ✓ "run ten at the same time" | ? | ? | ? | ? |
| Long tasks (hours) | ◐ Goal mode _verify_ | ✓ Computer | ✓ 15+ hours | ? | ? | ✓ ChatGPT Work | ✓ |
| Helper agents (sub-agents) | ✓ | ✓ Computer | ✓ "team of agents" | ✗ | ? | ? | ? |
| Saved prompts and templates | ✓ 22 templates | ✓ Shortcuts, default set | ✓ 260+ templates | ✓ Skills and Skills gallery | ✗ | ✓ Skills (beta), GPTs | ✓ Skills |
| Scheduled tasks | ◐ cloud workflows only | ✓ Automations, hourly and up | ✓ hourly to custom | ✗ | ✗ | ✓ Plus | ✓ Pro |
| Scheduled tasks that drive a browser | ✗ | ✓ "attended" runs | ✓ | ✗ | ✗ | ? | ? |
| Works in desktop apps, not just the browser | ◐ _verify_ agents at the cursor | ✓ desktop app drives Mail, Finder, Slack, Messages, Notes (Mac) | ✗ | ✗ | ✗ | ✓ computer use † | ✓ computer use |
| Block the agent on chosen sites | ◐ site blocks in the page runtime, no setting | ✓ | ? | ✓ MDM | ? | ? | ? |
| Memory | ◐ only what you ask it to remember | ✓ plus Brain (Max) | ✓ | ✗ phased out | ✓ | ✓ | ✓ |
| Voice | ✓ | ✓ 36 languages, 10 voices | ? | ✓ dictation | ✓ Gemini Live | ✓ | ✓ |
| Writing help on any selected text | ◐ Journal notes only | ✓ Inline Assistant | ? | ? | ? | ✗ | ✗ |
| Create decks, docs and reports | ✗ | ✓ Create files and apps | ? | ✓ Decks | ✗ | ✓ | ✓ Slides, Docs |
| Send the agent a task by email or Slack | ✗ | ✓ Computer in Email, Slack | ✗ | ✗ | ✗ | ? | ✓ @Claude (Team) |
| Connected apps | ✓ Composio | ✓ ~25 connectors plus MCP | ✓ connectors | ✓ ~20 apps | ◐ Google apps | ✓ apps and plugins | ✓ connectors |

### Models

| | Misty | Comet | Polar | Dia | Chrome | ChatGPT | Claude |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Choose the model | ✓ paid plans | ✓ paid plans | ✗ mixes models for you | ✗ GPT-5 for everything | ✗ Gemini | ◐ OpenAI's only | ◐ Anthropic's only |
| Makers to choose from | About 30 through the AI Gateway (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Qwen, Moonshot…) | 8: Perplexity, OpenAI, Anthropic, Google, xAI, Moonshot, Z.ai, NVIDIA | — | — | — | 1 | 1 |
| Flagship models on the first paid plan | ✓ | ✗ GPT-5.6 Sol and Claude Opus 5 are Max-only | — | — | — | ◐ | ✓ Opus on Pro |
| A different model for thinking, seeing, listening and speaking | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Ask several models at once and merge answers | ✗ | ✓ Model Council (Max) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Run the agent on your own hardware | ✗ | ✓ Portable Computer (NVIDIA) | ✗ | ✗ | ✗ | ✗ | ✗ |

### Working together

| | Misty | Comet | Polar | Dia | Chrome | ChatGPT | Claude |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shared workspace with notes, tasks and files | ✓ Spaces | ◐ shared Projects (Enterprise) | ◐ team billing, pooled credits | ✗ | ✗ | ✓ shared projects | ◐ Team plan only |
| Your agent asks a teammate's agent | ✓ | ✗ | ✗ | ✗ | ✗ | ? workspace agents | ✗ |
| Team plan | ✗ | ✓ Enterprise Pro from $40/seat | ✓ Teams $50/seat | ✓ Dia for Work | ✓ | ✓ Business | ✓ Team, Enterprise |

### Browser, sync and privacy

| | Misty | Comet | Polar | Dia | Chrome |
| --- | --- | --- | --- | --- | --- |
| Split view | ✓ any layout, saved presets | ✓ two tabs | ? | ✓ remembers layouts | ✓ |
| Profiles with separate sign-ins | ✓ | ✓ | ? | ✓ swipe between | ✓ |
| Pinned tabs and favorites | ✓ | ? | ? | ✓ Arc-style | ✓ |
| Tab sleeping | ✓ | ? | ? | ✓ | ✓ |
| End-to-end encrypted sync | ✓ | ✓ passphrase; bookmarks, passwords, autofill, history, extensions, tabs | ? | ✓ | ◐ with a passphrase |
| Website sign-ins carry over between your computers | ✓ some sites ask again | ✗ not in its synced types | ? | ✗ not in its synced types | ✗ |
| Built-in ad and tracker blocking | ✓ | ✓ | ? | ✓ | ✗ |
| Password manager | ✓ | ✓ | ? | ✓ | ✓ |
| Import from other browsers | ✓ including sign-ins | ✓ including passwords | ? | ✓ | ✓ |
| Cross-device clipboard | ◐ built, not shipped | ✗ | ✗ | ✗ | ✗ |

### Pricing

| | Misty | Comet | Polar | Dia | ChatGPT | Claude |
| --- | --- | --- | --- | --- | --- | --- |
| Free plan | Every feature, one fast model | Browser and search; no browser agent | 3,000 credits, +100 a day | Browser only, no AI | Chat, limited Work | Chat; no Claude in Chrome |
| First paid plan | $12 Pro | Pro, $20 † | $20 | Better Answers, $20 (the plans page also shows $10 on the card) | Go / Plus (prices not shown without sign-in) | $20 Pro ($17 yearly) |
| Top individual plan | $200 Ultra+ | Max, $200 † | Pro+ / Max | Better Days, $100 | Pro, three tiers | Max, $100–200 |

## What Misty can lead with (verified against all six)

- **Website sign-ins carry over between your computers.** Comet and Dia sync passwords and tabs, not sessions. Recheck Polar before publishing.
- **The agent is on the free plan.** Comet, Dia, Chrome and Claude put their browser agent behind a paid plan; Polar gives daily credits.
- **A different model for each job**, from about 30 makers. Comet offers 8 makers and keeps its flagships for Max; Polar, Dia and Chrome don't let you choose.
- **Flagship models from $12.** Comet's top models need Max.
- **Agents that ask a teammate's agent**, inside a shared Space.
- **41 MB on the system engine** against 431–716 MB of Chromium.

Claims that no longer hold and must not be used: "Comet has no scheduled tasks or helper agents", "Dia is Mac-only", "Dia has no ad blocking", "only Misty has end-to-end encrypted sync", "background agents only on Comet's $200 plan".

## Parity plan

Goal: Misty has everything the others have, so no public row shows Misty losing. A row stays off the website until its gap ships.

| ID | Gap | Who has it | What Misty already has | Size | Order |
| --- | --- | --- | --- | --- | --- |
| C1 | Scheduled tasks that drive the browser | Comet, Polar | Cloud schedules; keep-awake and device pick (Phase 6) | M | 1 |
| C2 | Agent stops before paying, sending, deleting or posting | Chrome, Polar, Comet ("no approvals needed" is opt-out) | Nothing since approvals were retired 2026-10-04; needs a narrow design | M | 2 |
| C3 | Template library: rewrite in Misty's own words and grow toward Polar's 260+ | Polar, Comet, Dia | 22 templates, but their names closely match Polar's (see note) | M | 3 |
| C4 | Writing help on any selected text on a web page | Comet | `AiSelectionMenu` in Journal notes | S | 4 |
| C5 | Block the agent on chosen sites, as a setting | Comet, Dia | Site blocks exist in the page runtime | S | 5 |
| C6 | Ask several models at once and merge the answers | Comet (Max) | Model breadth already there; a natural fit | M | 6 |
| C7 | Create decks, docs and reports as files | Comet, Dia, ChatGPT, Claude | Journal for notes; no file output | L | 7 |
| C8 | Send the agent a task by email or Slack | Comet, Claude | Composio Gmail and Slack | M | 8 |
| C9 | Ship the cross-device clipboard; confirm agents at the cursor | Misty-only rows | Built | S | 9 |
| C10 | Some model choice on the free plan | — (lead, not parity) | One fast model on Basic | S | 10 |
| C11 | Team plan with shared billing and pooled AI (no SSO, admin or compliance work) | Comet, Polar, Dia, ChatGPT, Claude | Spaces; billing per account | L | 11 |
| C12 | Chrome Web Store extensions | Comet, Dia, Chrome | In progress through Kiri | L | 12 |
| C13 | Extensions on Windows | Comet, Dia, Chrome | None on WebView2 | L | 13 |
| C14 | iPhone and Android | Comet, Chrome, ChatGPT, Claude | No mobile client | XL | 14 |
| C15 | Run the agent on your own hardware | Comet | Browser work already runs on your device; models don't | XL | later |

**Out of scope:** SOC 2 and other enterprise compliance, SSO, SCIM and MDM. Misty is not pursuing enterprise customers, so these never go on the chart or in the parity plan.

**Template wording.** Misty's 22 templates in `src/features/agents/workspace/taskTemplates.ts` use the same category set as Polar's gallery and near-identical titles ("Turn a listing page into a spreadsheet" vs Polar's "Turn any listing page into a spreadsheet", "Draft replies to messages waiting on me" vs "Draft replies to emails waiting on me", "Find the best price for an item" vs "Find the best price for this exact item"). Before a public page names Polar, rewrite these in Misty's own words.

## Website rules for this chart

- Six competitor columns at most: Comet, Polar, Dia, Chrome, and ChatGPT and Claude (together or separate).
- Publish only rows where every cell is ✓ or ✗ from the vendor's own page; drop rows with ? or †.
- No "where others are ahead" section; gaps close through the parity plan.
- Plain-text names, no logos or app screenshots. "Compared October 2026" with links to each vendor page.
- Recheck before every release; these products change weekly.

## Sources (vendor pages, read 2026-10-11)

- Comet and Perplexity: [Comet](https://www.perplexity.ai/comet), [Getting started](https://www.perplexity.ai/help-center/en/articles/11172798-getting-started-with-comet), [Shortcuts](https://www.perplexity.ai/help-center/en/articles/11897890-comet-shortcuts), [Scheduled Tasks in Computer](https://www.perplexity.ai/help-center/en/articles/11521526-perplexity-tasks), [What is Computer](https://www.perplexity.ai/help-center/en/articles/13837784-what-is-computer), [Work with browsers and apps](https://www.perplexity.ai/help-center/en/articles/19800006-work-with-browsers-and-apps), [Plans](https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you), [Max](https://www.perplexity.ai/help-center/en/articles/11680686-perplexity-max), [Models by plan](https://www.perplexity.ai/help-center/en/articles/10354919-what-advanced-ai-models-are-included-in-my-subscription), [Connectors](https://www.perplexity.ai/help-center/en/collections/18799295-connectors-integrations), Comet help: [Sync](https://www.perplexity.ai/help-center/comet/en/articles/12569908-sync-between-devices), [Split view](https://www.perplexity.ai/help-center/comet/en/articles/12324462-split-view-mode), [Profiles](https://www.perplexity.ai/help-center/comet/en/articles/11642916-profiles-on-comet), [Assistant panel](https://www.perplexity.ai/help-center/comet/en/articles/11734688-assistant-panel), [Control what the Assistant can use](https://www.perplexity.ai/help-center/comet/en/articles/12658082-control-what-comet-assistant-can-use), [Memory](https://www.perplexity.ai/help-center/comet/en/articles/12658438-comet-memory), [Inline Assistant](https://www.perplexity.ai/help-center/comet/en/articles/13533742-inline-assistant), [Voice](https://www.perplexity.ai/help-center/comet/en/articles/13860420-voice-mode), [Extensions](https://www.perplexity.ai/help-center/comet/en/articles/11734716-extensions)
- Polar: [Home](https://polarbrowser.com), [Pricing](https://polarbrowser.com/pricing), [Templates](https://polarbrowser.com/templates), [Introducing Polar](https://polarbrowser.com/blog/introducing-polar), [Blog](https://polarbrowser.com/blog), [Trust center](https://trust.polarbrowser.com/)
- Dia: [Home](https://www.diabrowser.com), [Plans](https://www.diabrowser.com/plans), [For Work](https://www.diabrowser.com/forwork), [Apps](https://www.diabrowser.com/apps), [Changelog](https://www.diabrowser.com/changelog), [1.52.0](https://www.diabrowser.com/changelog/mac/1-52-0)
- Chrome: [Gemini in Chrome](https://gemini.google/overview/gemini-in-chrome/)
- ChatGPT: [Pricing](https://chatgpt.com/pricing)
- Claude: [Pricing](https://claude.com/pricing)
- † third-party, still to confirm: Comet Pro and Max prices ([eesel](https://www.eesel.ai/blog/perplexity-comet-pricing)), Chrome extensions in ChatGPT's browser ([runtimewire](https://runtimewire.com/article/openai-chatgpt-desktop-browser-chrome-extensions)), ChatGPT computer use
