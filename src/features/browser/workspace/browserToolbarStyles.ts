import "./browserToolbar.css";

/** Browser chrome geometry. Buttons are the shared IconButton; icons use toolbarIconProps,
 * and browserToolbar.css sets both a size up inside the bar. */
export const browserToolbarStyles = {
  // Exactly the Browser grid's 52px toolbar row (`rowHeight`). A taller bar overflows onto
  // the page host; it hides under the native page until a drag raises the UI.
  rowHeight: 52,
  bar: "relative z-10 flex h-[52px] shrink-0 items-center gap-1.5 border-b px-3",
  group: "flex shrink-0 items-center gap-1.5",
  // Circular glyphs need a smaller optical size beside arrows and line icons.
  roundIcon: {
    size: 16,
    className: "size-4",
    strokeWidth: 1.75,
    "aria-hidden": true,
  } as const,
};
