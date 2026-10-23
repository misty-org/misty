# Media controls

Approved 2026-10-11; revised when the navigator rail was retired. The player now sits in the tab sidebar (`SidebarNowPlaying` in `src/app/layouts/DesktopLayout/`). The mockup (`mockups/index.html`) shows the earlier rail placement.

- While any browser tab plays sound, the tab sidebar shows one player card between the tabs and its foot. Nothing shows when nothing plays.
- The card shows the chosen source: the page's own artwork, its Media Session title (or the tab title), artist and site, a progress bar when the page reports a finite length, play/pause, previous/next only when the page registered them, and mute. Clicking the title or artwork goes to that tab.
- With several sources, breadcrumbs at the card's foot (dots between arrows) switch between them.
- A tab making sound keeps its speaker in the sidebar; clicking it mutes that tab.

Pages register media keys with `navigator.mediaSession.setActionHandler`, which cannot be read back, so a page script keeps a copy for the player (`browser_media_session.rs`). Only https artwork leaves the page.
