/**
 * The frame every control shares at each size: its height and its corners. Fields, selects, search
 * boxes, chips, segmented tracks and buttons of one size line up edge for edge in a row, with the
 * same rounding, so none looks smaller than the one beside it.
 *
 * Controls take their frame from here and nowhere else (the control-frame architecture test), and
 * features never set a control's height or corners (the field-restyle and button-restyle UI rules).
 *
 * sm 24 for inline controls inside rows and chips, md 32 for every bar and form (the default),
 * lg 36 for a page's one call to action.
 */
export const controlFrame = {
  sm: "h-6 rounded-md",
  md: "h-8 rounded-lg",
  lg: "h-9 rounded-lg",
} as const;

export type ControlFrameSize = keyof typeof controlFrame;

/** How far a field's text, or its leading icon, sits in from the frame's edge. */
export const fieldInset = {
  sm: "px-2",
  md: "px-2.5",
} as const;
