# Media controls

Approved 2026-10-11. Mockup: `mockups/index.html` (state 3, "Opened").

- While any browser tab plays sound, in any window, a plain monochrome speaker sits in the navigator rail's bottom controls, the same size as its other icons. Nothing shows when nothing plays. The rail never widens.
- Hovering the speaker opens the player beside the rail; clicking keeps it open until it is dismissed. Leaving both the speaker and the player closes a hover-opened player.
- The player has one card per playing tab: the page's own artwork, its Media Session title (or the tab title), artist and site, a progress bar when the page reports a finite length, play/pause, previous/next only when the page registered them, and mute. Clicking the title or artwork goes to that tab.
- A tab making sound keeps its speaker on the tab strip; clicking it mutes that tab.
- The per-pane music button on the tab strip is gone.

Pages register media keys with `navigator.mediaSession.setActionHandler`, which cannot be read back, so a page script keeps a copy for the player (`browser_media_session.rs`). Only https artwork leaves the page.
