import "./findHighlights.css";

/**
 * The CSS custom highlights a find in rendered text paints with (`CSS.highlights`), styled in
 * findHighlights.css: every match a faint wash of the text color, the current one a strong one.
 *
 * ```ts
 * CSS.highlights.set(FIND_MATCH_HIGHLIGHT, new Highlight(...ranges));
 * CSS.highlights.set(FIND_CURRENT_HIGHLIGHT, new Highlight(current));
 * ```
 */
export const FIND_MATCH_HIGHLIGHT = "misty-find-match";
export const FIND_CURRENT_HIGHLIGHT = "misty-find-current";
