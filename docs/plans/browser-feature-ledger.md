# Browser feature ledger

Core browser features that people rely on in Arc, Dia, Zen, Helium, Vivaldi and Chrome, compared with Misty, and the gaps Misty should close one at a time. Researched 2026-10-08.

Scope is the everyday browser: tabs, layouts, theming, search, profiles, accounts, privacy basics, reading and media. Positioning features that conflict with how Misty works are left out (for example Helium's zero-server stance, Vivaldi's mail and RSS clients, Arc's Easels).

Misty's column comes from the code on `kura-split`. Rows marked _verify_ were not confirmed in code and need a quick check before work starts.

Legend: ✓ has it · ◐ partial · ✗ missing · ? not confirmed

## Comparison chart

### Tabs and organization

| Feature | Misty | Arc | Dia | Zen | Helium | Vivaldi | Chrome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Side (vertical) tabs | ✓ left or right | ✓ | ✓ sidebar mode | ✓ | ✓ | ✓ | ✓ (2026) |
| Tab groups | ✓ | ◐ folders | ✓ | ✓ folders | ✓ | ✓ stacks | ✓ |
| Switchable tab sets (Spaces, Workspaces) | ✓ virtual windows | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ |
| Pinned tabs that persist and return to their pinned page | ✗ | ✓ | ◐ testing | ✓ | ✓ | ✓ | ✓ |
| Favorites shown in every workspace | ✗ | ✓ | ✗ | ✓ Essentials | ✗ | ✗ | ✗ |
| Auto-archive idle tabs | ✗ | ✓ | ✗ | ✗ (top request) | ✗ | ✗ | ✗ |
| Tab sleeping to save memory | ✗ _verify_ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reopen closed tab or window | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dedicated tab search | ◐ open tabs in address bar | ✓ command bar | ✓ | ✗ (requested) | ✓ | ✓ | ✓ |
| Tab hover preview | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ |
| Tab group sync across devices | ✓ once every device updates | ✓ | ? | ✓ | ✗ | ✓ | ✓ |

### Layouts and views

| Feature | Misty | Arc | Dia | Zen | Helium | Vivaldi | Chrome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Split view | ✓ any dock layout | ✓ | ? | ✓ up to 4 | ✓ | ✓ tiling | ✓ |
| Drag a tab into a split | ✓ | ✓ | ? | ✗ (requested) | ? | ✓ | ✓ |
| Movable navigation and tab strip | ✓ all four edges | ✗ | ✗ | ◐ | ◐ left or right | ✓ | ◐ |
| Saved layouts | ✓ presets | ✗ | ✗ | ✗ | ✗ | ✓ sessions | ✗ |
| One-key hide all browser chrome | ◐ navigator only | ✓ Cmd+S | ✓ focus mode | ✓ compact mode | ✗ | ✓ | ◐ full screen |
| Link preview without opening a tab | ✗ | ✓ Peek | ✗ | ✓ Glance | ✗ | ✗ | ✗ |
| Mini window for links from other apps | ✗ | ✓ Little Arc | ✗ | ✗ | ✗ | ✗ | ✗ |
| Rules for where external links open | ✗ | ✓ Air Traffic Control | ✗ | ✗ | ✗ | ✗ | ✗ |
| Picture-in-picture, automatic on tab switch | ✗ | ✓ | ✓ meetings | ✓ | ✓ | ✓ | ✓ |
| Controls for whatever is playing | ◐ per-tab mute | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Theming and appearance

| Feature | Misty | Arc | Dia | Zen | Helium | Vivaldi | Chrome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Light, dark, follow system | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Accent or per-workspace color | ✗ palette policy | ✓ | ✓ | ✓ gradients | ✗ | ✓ | ✓ |
| Scheduled theme switching | ◐ follow system | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Per-site restyling (CSS, hide elements, force dark) | ✗ | ✓ Boosts | ✗ | ✓ Boosts, Mods | ✗ | ◐ | ✗ |
| Density and interface zoom | ✓ | ✗ | ✗ | ◐ | ✓ | ✓ | ◐ |
| Customizable toolbar buttons | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ |

### Search and address bar

| Feature | Misty | Arc | Dia | Zen | Helium | Vivaldi | Chrome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Choice of default engine | ✓ 5 engines | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Add any search engine | ◐ custom bangs only | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bangs | ✓ plus custom | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Search suggestions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Browser actions from the address bar | ◐ separate command palette | ✓ | ✓ AI box | ✗ | ✗ | ✓ Quick Commands | ◐ |
| Find in page | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Profiles, accounts and sync

| Feature | Misty | Arc | Dia | Zen | Helium | Vivaldi | Chrome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Account sync of tabs and workspaces | ✓ end-to-end encrypted | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Several identities with separate sign-ins | ◐ one per Misty account | ✓ profiles | ✓ | ✓ | ✓ | ✓ | ✓ |
| Identity chosen per workspace | ✗ | ✓ | ✗ | ✗ (requested) | ✗ | ✗ | ✗ |
| Separate sign-ins in one window (containers) | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Private browsing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Import from other browsers | ✓ incl. sign-ins | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Privacy and security basics

| Feature | Misty | Arc | Dia | Zen | Helium | Vivaldi | Chrome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Built-in ad and tracker blocking | ✗ | ? | ✗ | ✗ add-on | ✓ uBlock Origin | ✓ | ✗ |
| Password manager and autofill | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Passkeys | ◐ Kiri, entitlement pending on macOS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Site permissions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Clear browsing data | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Reading, media and apps

| Feature | Misty | Arc | Dia | Zen | Helium | Vivaldi | Chrome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Reader mode | ✗ | ? | ✗ | ✓ | ? | ✓ | ✓ |
| Translate page | ✗ | ? | ✓ AI | ✓ | ? | ✓ | ✓ |
| Remembered zoom per site | ✗ _verify_ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Notes beside browsing | ✓ Spaces journal | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Chat with pages and tabs | ✓ Misty panel | ◐ | ✓ | ✗ | ✗ | ✗ | ✓ Gemini |
| Browser extensions | ◐ Kiri transport _verify_ | ✓ | ✓ | ✓ | ✓ MV2 | ✓ | ✓ |
| Install a site as an app | ✗ | ✗ | ✗ | ✗ (requested) | ✓ | ✓ | ✓ |
| DRM streaming (Netflix and similar) | ? _verify_ per engine | ✓ | ✓ | ◐ | ◐ | ✓ | ✓ |
| Custom keyboard shortcuts | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ◐ |
| Mouse gestures | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Trackpad swipe between workspaces | ✗ | ✓ | ✗ | ✗ (requested) | ✗ | ✗ | ✗ |

## What people say they can't do without

Reddit could not be read from this environment (blocked for both fetch and the browser pane), so evidence comes from Hacker News comments, Zen's GitHub Ideas board, Vivaldi's forum and press coverage.

- **Zen's most-voted ideas:** instant tab sync between computers (479), auto-closing tabs after a set time (232), a profile per workspace like Arc (218), native PWA support (175), dragging tabs into split view (151), better split view (138), multiple profiles in one window through workspaces (132), a tab search shortcut (111), trackpad gestures (86).
- **Arc users moving to Dia** miss vertical tabs, Spaces, the command bar, Cmd+S to hide the interface, quick profile switching without a new window, auto-archiving with pinned tabs that stay, Peek and split view.
- **Hacker News** keeps naming ad blocking with uBlock Origin, a built-in password manager, sync, containers or separate work and personal sign-ins, tab search and vertical tabs as reasons to stay on or switch browsers.
- **Dia's own roadmap** is adding Arc's sidebar, pinned tabs, Spaces, custom shortcuts and automatic picture-in-picture for meetings, which confirms those are table stakes.

## Gap ledger

Work top to bottom unless a decision is pending. Size: S under a day, M a few days, L a week or more.

| ID | Gap | Why it matters | Fit with Misty | Size | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Focus toggle that hides navigation and the tab strip together | Arc's most-missed shortcut; Zen and Dia ship it | Extends navigator auto-hide; one shortcut and command | S | P0 | Done |
| G2 | Tab search shortcut with a filterable list of open tabs in every window | Zen request (111); standard in Chrome and Arc | The omnibox already has an open-tabs provider to reuse | S | P0 | Done |
| G3 | Remembered zoom per site | Expected baseline in every browser | Zoom controls exist but reset per page | S | P0 | Done |
| G4 | Add any search engine, with keyword | Baseline; Helium and Chrome | Custom bangs exist; add full engines beside the five built in | S | P0 | Done |
| G5 | Pinned tabs per workspace that survive restarts and return to their pinned page | Most cited Arc and Zen habit | New state on workspace views; syncs with the workspace | M | P0 | Done |
| G6 | Favorites shown in every workspace | Arc Favorites, Zen Essentials | Builds on G5 | M | P0 | Done |
| G7 | Picture-in-picture, including automatically when switching away from a playing video or meeting | Dia added it; every browser has it | Needs engine work: WKWebView, WebView2 and WebKitGTK each expose PiP differently | M | P0 | Done |
| G8 | Tab sleeping for idle background tabs | Memory is a common complaint about Zen and Chromium browsers | Release hidden webviews and restore them from page state; page restore already exists | M | P0 | Done |
| G9 | Built-in ad and tracker blocking | uBlock Origin is a deciding factor for many people | Runs on device; WKContentRuleList, WebView2 request filtering, WebKitGTK content filters | L | P0 | Done |
| G10 | Peek a link in an overlay without opening a tab | Arc Peek, Zen Glance | Modifier-click opens a floating view that can be promoted to a tab | M | P1 | Done |
| G11 | Controls for whatever is playing, across tabs | Arc, Chrome, Vivaldi | Per-tab audio state exists through Kiri; add a now-playing control | M | P1 | Done |
| G12 | Auto-archive idle tabs, opt-in, with an archive to restore from | Zen's third most-voted idea; Arc's core habit | Opt-in setting; pinned tabs (G5) are exempt | M | P1 | Done |
| G13 | Browser actions from the address bar | Arc command bar, Vivaldi Quick Commands | Feed command palette commands into the omnibox | M | P1 | Done |
| G14 | Reader mode | Baseline in Chrome, Firefox and Safari | Readability-style extraction rendered as a Misty page | M | P1 | Done |
| G15 | Translate page | Baseline; Chrome, Firefox, Vivaldi | WebKit has no built-in translate; use the AI Gateway, which fits gateway-only AI | L | P1 | Done |
| G16 | Tab group sync across devices | Zen's top idea is instant sync | Already built: open groups sync as `tab_group` records and saved groups in the vault's collections, once every device runs a version that understands them | M | P1 | Done |
| G17 | Password manager and autofill | Most cited missing feature after ad blocking | Approved; see Decisions. Stored end-to-end encrypted in the sync vault | L | P1 | Done |
| G18 | Browser profiles on each device, each with its own virtual windows and sign-ins | Zen requests (218, 132); Arc profiles per Space | Built as device profiles: each is a workspace scope with its own virtual windows and website data, switched from the virtual-window menu. Profiles other than Default stay on this device; syncing them as extra workspaces is a follow-up | L | P1 | Done |
| G19 | Color picker for Misty's accent | Arc, Zen, Vivaldi, Chrome | Approved; see Decisions. Pastel presets plus a custom color, no token theming system | M | P1 | Done |
| G20 | Install a site as an app | Zen request (175); Chrome, Helium | Built as site apps: installed sites live (encrypted) in an Apps bookmark folder and each opens in its own named virtual window, from the browser menu or the address bar. A separate OS window with its own dock icon needs a multi-window native shell and is a follow-up | L | P2 | Done |
| G21 | Mini window for links opened from other apps | Little Arc | Built on Peek: Settings › Browsing › Links from other apps can open them in Peek over the current page, kept as a tab or closed | M | P2 | Done |
| G22 | Rules for where external links open | Arc Air Traffic Control | Built on device profiles: a profile lists the sites it claims, and links to them from other apps switch to that profile | M | P2 | Done |
| G23 | Per-site restyling | Arc and Zen Boosts | User CSS, hide element, force dark; needs a storage and sync story | L | P2 | Done |
| G24 | Tab hover preview | Chrome, Vivaldi, Helium | Card with title, site and a thumbnail on hover | S | P2 | Done |
| G25 | Trackpad swipe between workspaces | Arc; Zen request (86) | Horizontal swipe on the tab strip switches virtual windows | M | P2 | Done |
| G26 | Customizable toolbar buttons | Chrome, Helium, Zen, Vivaldi | Choose which browser toolbar buttons show | M | P2 | Done |
| G27 | Scheduled theme switching | Vivaldi | Only matters beyond Follow system if G19 lands | S | P2 | Done |
| G28 | Mouse gestures | Vivaldi | Niche; consider only after P1 | M | P2 | Done |
| G29 | DRM streaming check | Netflix, Disney+ and Spotify Web need it | Built as detection: when a page asks for protected-video key systems and none works, the tab says so and offers to open the page in the system browser. Which key systems each engine supports (FairPlay in WebKit on macOS, Widevine or PlayReady on WebView2, WebKitGTK) still needs a playback check on each platform | S | P2 | Done |

## Decisions

Recorded 2026-10-08.

### G17: password manager and autofill

- Misty gets a password manager with autofill. This replaces the browser-import plan's note that Misty has no password manager.
- Every saved password is encrypted on the device with the vault key before it leaves the device. The server and its database hold only ciphertext, so a server or database leak exposes nothing usable.
- Once this exists, browser import can also bring over saved passwords. The browser-import plan currently lists them as out of scope.

### G18: profiles within a device

- Today the levels are account, then devices, then virtual windows. Virtual windows only switch layouts; every window on a device shares the same website sign-ins.
- The new level is a profile. Each device holds one or more profiles. Each profile owns its own set of virtual windows and its own website data, so sign-ins are separate between profiles.
- Resulting hierarchy: account → device → profile → virtual window → tab → pane → view → page.
- Open design question: in the sync model a workspace is already one device sign-in's windows, tabs and website sign-ins, and the native side already keeps a separate cookie store per browser profile. A profile may be expressible as several workspaces per device, or it may need a new record. Settle this in a design brief before building, and keep the sync vocabulary to one name per level.
- AGENTS.md still applies: Settings gets no profile picker and no per-profile settings, so settings stay account-wide. Where profiles are switched is part of the design brief.

### G19: color

- Add a color picker that themes Misty with one accent. Presets are the pastel colors Spaces already use for avatars, plus a custom color picker.
- No token-based theming system. One accent color is applied to a small, fixed set of surfaces.
- AGENTS.md currently requires the monochrome palette. Add an exception there for the accent surfaces when this ships.

## Already on par or ahead

Misty already matches or beats these browsers on: side tabs on any edge, tab groups, virtual-window workspaces, free-form split panes with drag-to-dock, saved layout presets, reopen closed tabs and windows, light/dark/system, density and interface zoom, five search engines with bangs and custom bangs, search suggestions, find, private tabs, custom shortcuts, end-to-end encrypted sync, device management, account switching, site permissions, clear data, import from other browsers including sign-ins, notes in Spaces, and chat with pages through the Misty panel.

## Sources

- [Zen Ideas board, sorted by votes](https://github.com/zen-browser/desktop/discussions/categories/ideas?discussions_q=is%3Aopen+sort%3Atop)
- [Zen features guide 2026](https://supasidebar.com/blog/zen-browser-features-guide-2026)
- [Helium features overview](https://mintlify.wiki/imputnet/helium/features/overview)
- [Dia adds Arc's greatest hits (TechCrunch)](https://techcrunch.com/2025/11/03/dias-ai-browser-starts-adding-arcs-greatest-hits-to-its-feature-set)
- [Dia launch features (iGeeksBlog)](https://www.igeeksblog.com/dia-ai-browser-mac-launch/)
- [Arc (Wikipedia)](https://en.wikipedia.org/wiki/Arc_(web_browser))
- [Ways Arc transforms browsing (How-To Geek)](https://www.howtogeek.com/888738/ways-arc-transforms-your-web-browser-experience/)
- [Arc users on Dia (Browser Company Substack comments)](https://browsercompany.substack.com/p/the-strategy-behind-dias-design/comments)
- [Vivaldi Accordion Tabs and Command Chains](https://vivaldi.com/blog/vivaldi-introduces-accordion-tabs-and-command-chains/)
- [Vivaldi theme scheduling (Windows Central)](https://windowscentral.com/latest-update-vivaldi-browser-introduces-theme-scheduling)
- [Chrome vertical tabs (AlternativeTo)](https://alternativeto.net/news/2026/4/chrome-finally-brings-vertical-tabs-and-an-immersive-reading-mode-for-better-productivity)
- Hacker News comment searches for [Arc alternatives](https://hn.algolia.com/api/v1/search?query=Arc%20browser%20alternative%20miss&tags=comment&hitsPerPage=40), [Zen](https://hn.algolia.com/api/v1/search?query=Zen%20browser&tags=comment&hitsPerPage=40) and [Helium](https://hn.algolia.com/api/v1/search?query=Helium%20browser&tags=comment&hitsPerPage=40)
