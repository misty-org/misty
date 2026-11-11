import "./browserToolbar.css";

/** Page toolbar geometry. Buttons are the shared IconButton; icons use toolbarIconProps, and
 * browserToolbar.css sets both a size up inside the bar. */
export const browserToolbarStyles = {
  group: "flex shrink-0 items-center gap-0.5",
  // Circular glyphs need a smaller optical size beside arrows and line icons.
  roundIcon: {
    size: 16,
    className: "size-4",
    strokeWidth: 1.75,
    "aria-hidden": true,
  } as const,
};
