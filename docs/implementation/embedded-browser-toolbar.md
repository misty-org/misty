# Embedded browser toolbar

Social, Inbox, Journal, Planner, and Library share `WebsiteHeader` for their embedded websites. The toolbar places a Pin toggle immediately before More. A filled pin and pressed state indicate that the current destination is saved; its tooltip and accessible action become Unpin. More contains only Zoom and Open link. Zoom stays open during repeated adjustments.

Pinning saves immediately, without a naming dialog. Unpin removes the current destination without closing or reloading the website. `usePagePin` owns storage refresh, pending state, and failure reporting for both existing pin stores. Concurrent saves use a deterministic destination ID. Navigation deduplicates legacy pins; Unpin removes all old copies of the selected destination. Titles omit unread-count prefixes and redundant platform names.

URL hashes and query strings remain part of destination identity. Existing native session IDs remain part of storage identity so saved links continue to open in the session that owns them. Pinning cannot save temporary authentication URLs.

The old toolbar profile controls, sidebar visibility action, pin editor, search/sharing actions, and legacy-view shortcuts were removed from this menu. Integration setup remains available through the app's sidebar control. Existing native sessions and stored pins remain compatible.

Validation covers toolbar actions, disabled and pending states, zoom, persistence, duplicate cleanup, multiple panes, concurrent saves, failures, safe URLs, destination navigation, and native-view continuity across all ten Social/Inbox providers. Journal, Planner, and Library use the same toggle and have store coverage. The rendered toolbar was visually checked at wide and 280px pane widths in a local renderer preview; native third-party website sign-in was not exercised by that preview.


## Browser and sidebar follow-up

Browser now uses the same `BrowserMenuView` and `PagePinButton` as the embedded
integrations. More contains only Zoom and Open link. Reload remains on the toolbar;
the address field retains normal text selection and copying.

Browser stores page pins in its own account-scoped local SDK storage. URL-based
IDs prevent duplicate saves; queries and fragments remain distinct destinations.
The Browser sidebar always exposes a disclosure, with saved pages beneath it and
a short empty-state hint before the first pin. Cached navigation keeps shortcuts
available after the app closes. Selecting a saved destination reuses the native
view; pinning or unpinning never reloads it. Other embedded apps retain their
provider/session ownership and existing sidebar pins.

Browser's catalog permission version is increased to declare storage read/write.
Existing installations use the normal permission-update flow when receiving the
updated catalog. No account sessions or pin records are moved between apps.

Validation covers Browser persistence/reopen, sidebar registration, native view
continuity, simultaneous saves, pane synchronization, failed-save retry, safe URL
validation, shared menu zoom/open behavior, and existing sidebar navigation.
The desktop toolbar and sidebar were also checked in a rendered preview.

## Native scrolling ownership

Embedded websites own their overflow, scrollbars, fixed-element transforms, and
scroll position. Misty must not inject page-wide overflow or overscroll rules,
custom horizontal scrollbars, document-width corrections, or scroll-restoration
timers. Zoom uses the native WebView API on macOS and iOS. macOS retains its
native scroll elasticity. Background browser views and popups use throttling.

The shared browser view measures its host in response to resize, scroll,
visibility, ancestor layout changes, and SDK layout notifications. It coalesces
updates into a frame and settles native window resizing once; it does not poll
every frame while idle. All observers, listeners, and scheduled work are released
when the view closes. App zoom explicitly requests a fresh native layout.

The scrolling regression fixture exercises an animated 1,200-element page in
Misty's native WebView at 100%, 125%, 200%, and 500% zoom. At every zoom, smooth
scrolling must reach both axis targets without injected scrollbar elements,
style scans, scroll resets, or changed page-owned header transforms. Run
`scripts/browser-viewport.test.mjs` for page-style/gesture checks and the native
`sdk_package_probe` example with `MISTY_SDK_PROBE_APP=browser` and
`MISTY_SDK_PROBE_ZOOM=1` against the local development server for WebKit coverage.
`WebsiteViewLifecycle.test.tsx` covers idle behavior, coalescing, resize settling,
tab continuity, and cleanup. These checks cover the known browser-side causes;
they do not establish that every third-party page or reported system freeze is
free of unrelated performance or memory issues.
