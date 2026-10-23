# Browser

The browser itself: tabs, pages, media controls and what is different on each platform.
Misty is a browser first, and it has to be worth using with no AI at all.

| To learn about | Read |
| --- | --- |
| Browsing with no account: sign-in only for sync, Spaces and agents | [no-account.md](no-account.md) ([mockup](mockups/no-account.html)) |
| The now-playing card in the tab sidebar | [media-controls.md](media-controls.md) ([mockup](mockups/media-controls.html)) |
| Known Windows limits and checks | [windows-limits.md](windows-limits.md) |
| The native web platform layer under the engine | [../kiri/README.md](../kiri/README.md) |
| Extensions | [../kiri/README.md](../kiri/README.md#extensions) |
| Interface rules for tabs, sidebars and chrome | [../ui/README.md](../ui/README.md) |

Code lives in `src/features/browser/`, `src/features/webviews/` and
`src-tauri/src/infra/browser/`.

## Interface rules

- Browsing never needs an account (`docs/browser/no-account.md`). Sign-in is asked only for sync, Spaces and agents, through the shared sign-in sheet over the window (`SignInSheet` in `src/features/auth/signInSheet/`), whose title names the reason; nothing prompts on a timer. A signed-out window shows no Space: no Space bar and no Space color, and the sidebar's account row reads Sign in. The bar appears once the person signs in. Signing out keeps browsing on the device.
