/** Browser chrome geometry. Buttons are the shared IconButton; icons use toolbarIconProps. */
export const browserToolbarStyles = {
  bar: "relative z-10 flex h-11 shrink-0 items-center gap-1 border-b px-2",
  group: "flex shrink-0 items-center gap-1",
  // Circular glyphs need a smaller optical size beside arrows and line icons.
  roundIcon: {
    size: 14,
    className: "size-3.5",
    strokeWidth: 1.75,
    "aria-hidden": true,
  } as const,
};
