# Extensions

Mode: Operate. Inherit the Spaces collection geometry, 36 px search, list/grid
controls, and monochrome palette. There is no Extensions sidebar: the page is titled
Extensions, and everything that used to live in a rail is a row of shared chips.
The section chips are Discover, Popular, Recently updated (three orderings of the
Firefox Add-ons catalog) and Installed; Installed is its own route
(`/extensions/installed`). Beneath them a second chip row narrows the view: All plus
the catalog's categories (`?category=`) under the catalog sections, or All, Enabled,
Disabled and Needs attention under Installed. Category chips are text only. Visible
sections must not be duplicated by a filter menu.

Extension grids use compact collection cards with 32 px, uncropped icons. Keep
names readable across two lines and place Install/Manage below the metadata,
outside the card's detail button. Icons must never fill a preview area or scale
with card width; only actual image previews use the artwork layout.
Cards use a continuous hover surface and 16 px content insets, with 12 px between
metadata and the action row. Loading uses matching grid, list, or detail skeletons
with reduced-motion support. Detail pages put Back above the title on the left,
retain the originating category, and group their header and metadata within a
readable 768 px content column.

Installation is a permission review, with private access selected by default.
Account intent and actual local runtime state are distinct. A failed or unsupported
runtime must never be represented as enabled. Extension descriptions are plain text.

The browser toolbar has an extensions menu and a separate control for its pinned
strip. The strip expands horizontally with reduced-motion support. Pin selection
uses checkmarks; extension artwork keeps its official colors. All preferences use
the server-backed account settings system.

The runtime is the system `WKWebExtension`. Misty adds a compatibility layer
(`src-tauri/src/infra/extensions/compat/`) for Firefox APIs WebKit lacks. Its
scripts load before an extension's own and define only missing APIs. Calls that
need Misty's data go through a hidden host page per extension. The native host
checks the account's granted permission, and `compat/` in this folder answers
them. Install review blocks only `debugger`, `proxy` and `sidePanel`; partially
covered permissions are listed as findings, never presented as fully working.
