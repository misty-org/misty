# Embedded Browser frame pacing

## Finding

On macOS 26.5.2 with the built-in 120 Hz ProMotion display, WebKit's
`PreferPageRenderingUpdatesNear60FPSEnabled` feature was left enabled. The page's
JavaScript animation updates ran at roughly 60 Hz. This cadence mismatch can make
scroll-driven animation look uneven even without long JavaScript frames.

A native comparison ruled out Misty's resizing configuration as the source of
this limit: an ordinary Wry/WKWebView, the same view after Misty's resize setup,
and the old production Browser each produced 151 animation intervals in 2.5 s.
The WebKit view hierarchy and redraw policies matched in all three cases.

## Change

New Browser views disable that single frame-rate preference during native setup,
before the initial document commits. WebKit then schedules page updates at the
available display rate. This applies to the shared Browser/provider creation path;
authentication popups inherit their source WebKit configuration.

This is a **private WebKit feature API**, consistent with the existing macOS
private-API build. Availability is checked at runtime and unsupported versions
retain their defaults. This is not suitable for a future Mac App Store build
without revisiting the private API policy. Higher animation rates may use more
power; WebKit still controls scheduling under system resource constraints.

WebKit's [feature API](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKPreferencesPrivate.h)
and [frame-rate preference history](https://bugs.webkit.org/show_bug.cgi?id=221673)
provide the upstream context. Changing the preference on an already-loaded page
was insufficient in the local test; it took effect on the next document.

## Native verification, 2026-09-08

Each measurement ran for 2.5 seconds while slowly scrolling. These are
`requestAnimationFrame` measurements, not a recording of compositor output or a
physical trackpad gesture.

| Native view | Animation intervals | Approx. fps | Longest interval |
| --- | ---: | ---: | ---: |
| Plain WebKit fixture | 151 | 60 | 19 ms |
| Same fixture with Misty resize setup | 151 | 60 | 20 ms |
| New Browser with the fix, first document | 301 | 120 | 11 ms |
| localhost:5174 homepage, before | 150 | 60 | 21 ms |
| localhost:5174 homepage, after | 299 | 120 | 26 ms |

The viewport remained 1000 × 500 and scrolling progressed normally. The homepage
had one interval above 25 ms after the change; this does not establish that every
possible source of visible flicker is eliminated.

## Repeat

The debug harness uses disposable native windows and profile directories. No
commands are registered in the normal application. On a high-refresh display,
turn off Low Power Mode and avoid competing performance tests.

```sh
MISTY_SDK_PROBE_BROWSER_RENDERING=1 \
MISTY_SDK_PROBE_TIMEOUT_SECONDS=120 \
node scripts/sdk-package-probe-run.mjs browser ../misty-apps
```

Optionally add `MISTY_BROWSER_RENDER_WEBSITE=http://localhost:5174/` to compare a
running local website as well. The runner needs the existing candidate catalog and
assets; this rendering mode does not install or execute the candidate package.

The probe checks that the first Browser document exceeds 80 fps on a display of
at least 100 Hz, and that viewport geometry and scrolling remain intact. Other
displays still report their measured cadence and validate geometry. Rebuild and
restart the native desktop process to exercise the change in the full app.
