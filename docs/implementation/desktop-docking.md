# Desktop docking

The desktop shell lets users move global navigation and workspace tabs independently through Settings → Layout, without a persistent layout button in the chrome. Each virtual window owns its arrangement. Each supports four edges; navigation and tabs must use different edges, yielding 12 valid arrangements. Occupied edge choices are visibly disabled, and the store rejects invalid combinations.

| Preset | Navigation | Tabs |
| --- | --- | --- |
| Classic (default) | Left | Top |
| Top bar | Top | Left |
| Bottom dock | Bottom | Left |
| Right rail | Right | Bottom |

Side tabs keep New tab in a fixed heading above an independently scrolling tab list. Vertical tabs expose vertical orientation and arrow-key navigation. Top tabs remain in the 38px native title-bar band, with measured insets for navigation, Control, and window controls. The titlebar matches the black app workspace, including beneath the macOS traffic lights: `.misty-docking-frame::before` paints `--misty-theme-workspace` behind the transparent titlebar layer rather than exposing desktop wallpaper. The overlaid title bar passes pointer events through to those tabs. Side/bottom tabs and standalone routes retain a separate draggable top band. Workspace content retains stable identities and stays mounted as docking changes. The mobile shell is outside this feature’s scope.

The customizer applies changes immediately. It identifies the current virtual window; its controls and Save preset action use the normal Settings content scroll. Named layouts can be restored or deleted; Reset to Classic restores the default arrangement. Save feedback uses a status region.

Each arrangement persists as `dockingLayout` on its virtual window, so switching windows or Spaces, restoring a workspace, and reopening a closed window restore the correct arrangement. Named presets remain shared on the device under `misty:desktop-docking:v1`. The previous device-wide choice becomes a fixed initial arrangement for windows without an explicit choice; editing one window never changes that fallback. Names are trimmed and limited to 40 characters; saving an existing name, compared case-insensitively, updates that saved layout. Empty names are rejected. Invalid persisted window layouts fall back to the initial arrangement, and invalid saved layouts are discarded.

Implementation lives in `src/features/app-shell/dockingLayout.ts` and `src/application/layouts/DesktopLayout/`, principally `index.tsx`, `dockingGeometry.ts`, `docking.css`, `GlobalNavigator.tsx`, `WorkspaceCanvas.tsx`, and `WorkspaceLayoutTabs.tsx`. The editor is `src/features/settings/sections/LayoutSection.tsx`; `src/features/workspace/useWindowDockingLayout.ts` supplies the same active-window choice to Settings and the shell.

The original [finish review](../../.impeccable/review/docking/REVIEW.md) records a **Ship** verdict for the reviewed macOS desktop scope, based on native 1280×820 captures of the four presets and a custom bottom-navigation/right-tabs arrangement. It is a bounded screenshot and code review; its limitations remain applicable, including unreviewed narrow windows, many or long tabs, Windows chrome, and transient interaction states.

The Settings relocation is covered by editor interaction, window/scope switching, persistence, snapshot restore, and closed-window reopen tests. The earlier screenshot review covers the prior chrome entry point, not the relocated editor.

The later titlebar and Control refinement received a **Ship** disposition for bounded browser-fixture UI only. The [desktop capture](../../.impeccable/review/device-control/desktop.png) shows that refinement; it does not establish packaged-native parity or replace the original docking review’s scope.
