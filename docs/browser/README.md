# Browser

The browser itself: tabs, pages, media controls and what is different on each platform.
Misty is a browser first, and it has to be worth using with no AI at all.

| To learn about | Read |
| --- | --- |
| Browsing with no account: sign-in only for sync, Spaces and agents | [no-account.md](no-account.md) ([mockup](mockups/no-account.html)) |
| The now-playing card in the tab sidebar | [media-controls.md](media-controls.md) ([mockup](mockups/media-controls.html)) |
| Known Windows limits and checks | [windows-limits.md](windows-limits.md) |
| Security boundaries and open problems | [security.md](security.md) |
| The native web platform layer under the engine | [../kiri/README.md](../kiri/README.md) |
| Extensions | [../kiri/README.md](../kiri/README.md#extensions) |
| Interface rules for tabs, sidebars and chrome | [../ui/README.md](../ui/README.md) |

Code lives in `src/features/browser/`, `src/features/webviews/` and
`src-tauri/src/infra/browser/`.

## Resizing the window

On macOS AppKit sizes the renderer and the page on screen on every step of a drag, so the window
never waits on a native call from the renderer. Hidden and parked pages sit out the drag and catch
up once when it ends (`src-tauri/src/platform/plugins/mac_live_resize.rs`), because each page
resized is another process laying out. Work the renderer runs per step costs frames: measure when
something asks, or wait for the window to settle, rather than keeping sizes in React state.

## Interface rules

- Every site icon goes through `SiteIcon` (`src/features/webviews/SiteIcon.tsx`), never an image tag. The app fetches it (`browser_site_icon`: no cookies, public addresses only), because sites such as X and Gmail send `Cross-Origin-Resource-Policy` and WebKit would refuse them. A site on this computer or network loads directly in the window. An icon that would vanish on the theme, like a black glyph on a dark one, gets a small backing in the theme's brightest text color; an icon with its own ground or color gets none.

- Browsing never needs an account (`docs/browser/no-account.md`). Sign-in is asked only for sync, Spaces and agents, through the shared sign-in sheet over the window (`SignInSheet` in `src/features/auth/signInSheet/`), whose title names the reason; nothing prompts on a timer. A signed-out window shows no Space: no Space bar and no Space color, and the sidebar's account row reads Sign in. The bar appears once the person signs in. Signing out keeps browsing on the device.
- Without a Misty server chosen on this device, Misty is the browser only. The sign-in sheet is also the setup wizard: with no server it starts on Misty Pro (the usual sign-in on Misty's server), My own server (its address, then the usual sign-in there) or Just browse, with Use a sign-in link beside them, and after signing in it goes on to the model step. On the first-run welcome it then sets up this computer (import, extensions) before the browser opens, so setup never sits over browsing. The tab side is asked once, when the browser is on screen and the tabs can be seen moving. The first-run welcome opens it once; Settings › Server opens it later. A release build only takes a server on an https domain, and treats a saved address that isn't one as no server (`isAllowedServerUrl`). It also refuses, when connecting, a domain that resolves to a private address (`probeServer`), except Misty Pro's own. Only a development build takes plain http or this computer. Copy is plain sentences, never headlines. Code is in `src/features/auth/setup/`.
- Cmd/Ctrl with +, - and 0 zooms only the focused page, remembered per site (private tabs keep their own and save none); on any other surface those keys do nothing. Misty's own interface scale is the same keys with Shift (`app.zoom_*`). Never let the unshifted keys scale the app. Code: `src/features/browser/workspace/pageZoom.ts` and `src/features/shortcuts/`.
- Back and forward by gesture, one arrow for all of them: a black circle slides in from the edge the gesture leads to (the top for reload) and turns white once letting go would navigate. A two-finger trackpad swipe past the page's edge goes back (swipe right) or forward (swipe left) and is always on; sideways scrolling the page or an element can take, or a page that handles sideways wheel itself, comes first, and a scroll that reached the edge must pause before the next swipe navigates. A right-drag (left, right, up for back, forward, reload) needs Settings › Advanced › Mouse gestures. A mouse's back and forward side buttons on a page go back and forward (macOS only, through the native mouse monitor in `src-tauri/src/infra/browser/click_focus.rs`; Misty does not wire them on Windows). The page side is `src-tauri/src/infra/browser/scripts/context_menu.js`; the app runs them through `misty-context-menu:gesture` (`context_menu/page_signals.rs`).
- A notice, such as Save password?, never blocks the page on macOS. The renderer draws it, so pages sit beneath the renderer while one shows, but clicks, scrolling and hover past the notice's own box fall through to the page (`src-tauri/src/infra/browser_pointer_guard_macos/notice_regions.rs`). A menu or dialog open at the same time takes every click as usual. On Windows the page stays above the renderer with the notice's box cut out of its window region (`src-tauri/src/infra/browser/page_frame_windows/`), so the notice takes clicks in its own box and the page takes the rest. Linux still holds the page until the notice closes.
- Saved sign-ins for a focused field show in `PasswordFillMenu`, drawn by the renderer as a notice under the field, never in the page: the page keeps the keyboard, learns nothing until a row is clicked, and can't click one itself. Only a person's click on a row fills, through `browser_page_password_fill` ([security.md](security.md)). Page scripts run in the page's own JavaScript world, so anything a page must not read or click doesn't belong in its document.
- Anything the renderer floats in a corner has to register as a notice, or a page there covers it. Use `Notification` (`src/shared/ui/feedback/Notification.tsx`), which also stacks notices and gives each a dismiss button, so nothing can hold a page on Linux with no way out. The live capture panel isn't a plain notice, so it carries `data-misty-notification` itself; on Linux the page stays held while it is open, because Stop has to stay reachable while Misty is listening.
- A menu, popover or dialog over a page keeps the mouse to itself in every Space window. An open one is found in the DOM (`src/features/webviews/browserBlockingOverlay.ts`), so a popup built on the shared overlays needs no wiring, and the page drops beneath the renderer. On macOS the page then gets no hover or cursor events, including the mouse moves AppKit sends straight to a focused page (`src-tauri/src/infra/browser_pointer_guard_macos.rs`). Peek is the exception: the page it shows stays live.
