# Navigation reordering

Saved website pages use the same 13px text as platform rows and a neutral link
icon. Pins are links with a separate Unpin action, styled like the header's add
button. It appears on row hover or keyboard focus and stays visible on touch
screens. Selected destinations retain their normal selection surface.

Sidebar unpinning deletes only the selected pin from the same deployment,
account and app storage used by the toolbar. Navigation registrations and their
saved cache update immediately, and the existing app invalidation events refresh
open toolbars. No workspace page is opened, closed or navigated by this action.
Repeated clicks are guarded; a failure keeps the shortcut and shows a retryable
inline error.

Tabs and sidebar sections use captured pointer gestures with a six-pixel movement
threshold. They never start HTML drag-and-drop, so the desktop's native file-drop
support stays enabled. Drag titles to reorder; close, add, and disclosure buttons
keep their own actions. A translucent copy of the painted row or tab follows the grab point, preserving
its dimensions, icon, title, controls and selected styling. Expanded descendants
stay in the sidebar. The preview is inert and hidden from assistive technology;
SVG references are remapped to avoid duplicate control IDs. An insertion line
shows the destination. App headers can be grabbed across their row, while
expand and integration buttons retain their actions.
Escape, pointer cancellation, lost capture, button release outside a target,
window blur, hidden document, or source unmount release the gesture safely.
Scrolling lists scroll at their edges. A delayed-click guard prevents release
from opening a link, activating a tab, or toggling a section.

The Browser runtime suspends native content for the lifetime of an active reorder
gesture. Pointer capture and window-level capture listeners retain control over
child webviews; the DOM shield prevents the gesture from reaching page controls.
Native window dragging remains excluded by the existing titlebar suppression
selectors. No Tauri native drag/drop setting is changed.

- Main sidebar sections reorder independently from their children.
- Platforms reorder within their app. Saved pages reorder within their parent.
- Sidebar order is account-specific and persists through the existing native
  settings store, including changes made before settings finish loading.
- Workspace tab groups reorder as groups in the top bar. Individual tabs can
  reorder within their group menu. Dragging between panes retains existing docking.
- File/location tab strips also use pointer reordering, including moves between
  compatible strips.
- Same-pane reordering preserves the focused pane, active tab, tab objects and
  native instance identities. It changes order without closing or reopening pages.

Keyboard: focus a title and use Alt+Shift+Left/Right for tab bars or
Alt+Shift+Up/Down for sidebar rows and grouped tab menus.

Validation: pointer gesture cancellation and click suppression, keyboard control,
settings hydration/account separation, tab-order integrity, page DOM continuity,
existing sidebar behavior and native titlebar exclusion. Manual browser preview
confirmed tab dragging, section and saved-page reordering, typography, and keyboard
movement. The follow-up appearance check confirmed translucent tab and platform
previews retain icons and sizing, nested platforms carry their children, and app
sections reorder from empty header space. Native Misty automation timed out and the app was absent from the native
app inventory; macOS/WebView2 interaction with live child webviews still needs a
native run. Browser preview success is not native OS verification.

Relevant platform references:
- https://v2.tauri.app/reference/config/#windowconfig
- https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture

App headers now use one full-width button for the icon, title, chevron and empty
row space. The add/configure action remains separate. Clicking an inactive app
expands it and resumes its last page; clicking the active expanded app collapses
it. Provider dropdowns use the same full-row behavior. Existing tabs retain their
identity and state, and remembered routes stay within the current account/Space.
The active layout takes precedence over cached window snapshots. Temporary
integration drawers are removed when returning to the page.

Top-level app reorder targets use header positions rather than the midpoint of
expanded children. The insertion marker still shows the boundary of the complete
app section being moved. Browser interaction verified clicks in empty row space,
Social returning to its Messages pin, repeated-click collapse, and moving the
Files app above Social without navigating away from the current page.

## Tab controls and browser chrome

Top-level app groups keep a stable 14px app icon. Single-page groups reserve a close button that appears on hover or keyboard focus. Groups with multiple pages show `(count)` beside the title and a separate chevron control. Dropdown rows contain the page icon, title and close button on one line, without repeating the app label. Clicking a group resumes its current or last-used page without cycling. Closing a menu page does not activate it.

Embedded browser bars use 16px app and action icons with their existing 30px button targets. Unread counts follow the page title as smaller, muted parenthesized text, such as `Messages (2)`.
