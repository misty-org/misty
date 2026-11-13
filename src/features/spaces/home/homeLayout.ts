/*
 * A Space's home. Every block shares one column system, so edges line up down the page: on a wide
 * pane pages sit six across, agents and items three (four when there is room), and paired panels
 * two, each a whole number of page tiles wide. The home (and the items' wrap) is the container the
 * grids measure.
 */

/** The home itself: its blocks down one column. */
export const spaceHomeClass = "@container grid gap-7 pt-3";

/** The wrap the items' grid measures when the home shows items instead of its overview. */
export const homeItemsWrapClass = "@container";

/** A block: its heading, then whatever it holds, the holder taking the rest of the height. */
export const homeSectionClass = "grid min-w-0 grid-rows-[auto_1fr] content-start gap-2.5";

/** The Space's pages: two, three, then six across. */
export const homePlacesClass =
  "grid grid-cols-2 gap-3 @min-[520px]:grid-cols-3 @min-[800px]:grid-cols-6";

/**
 * Panels in pairs on a wide home; an odd block out takes the whole row instead of leaving a hole
 * beside it.
 */
export const homePairClass =
  "grid grid-cols-1 items-stretch gap-x-3 gap-y-7 @min-[800px]:grid-cols-2 " +
  "@min-[800px]:[&>:last-child:nth-child(odd)]:col-span-full";

/** Items (and agents): one, two, three, then four across. */
export const homeItemsClass =
  "grid grid-cols-1 gap-3 @min-[520px]:grid-cols-2 @min-[800px]:grid-cols-3 @min-[1200px]:grid-cols-4";

/**
 * The agents' cards on the home, in the items' columns: the home's columns replace the cards' own
 * grid (AgentsNow's `agents-now`).
 */
export const homeAgentsClass =
  "[&>.agents-now]:grid-cols-1 @min-[520px]:[&>.agents-now]:grid-cols-2 " +
  "@min-[800px]:[&>.agents-now]:grid-cols-3 @min-[1200px]:[&>.agents-now]:grid-cols-4";

/** A page tile's frame: one slim row, its icon on a quiet square, then its name. */
export const homePlaceClass =
  "flex h-12 min-w-0 items-center gap-2.5 px-3 text-left text-meta transition-colors duration-120";

/** A row on a panel: its mark, its title over one quiet line, then what belongs at its end. */
export const overviewRowClass = "flex w-full min-w-0 items-center gap-3 px-2.5 py-2";
