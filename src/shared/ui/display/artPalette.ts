/**
 * The full-color art palette (theme.css --color-art-*): what is drawn on or over art, such as the
 * Studio's room, a whiteboard in it or Tutor's cursor. Its colors stay fixed in either theme, so
 * they read on the art and not on the page. Features pick one through `Text`'s and `Surface`'s
 * `art`, `ring` and `tint` props, never a class.
 */
export type ArtColor =
  | "white"
  | "paper"
  | "gray"
  | "muted"
  | "ink"
  | "navy"
  | "green"
  | "green-ink"
  | "amber"
  | "red"
  | "red-ink"
  | "blue";

/** Text in an art color. */
export const artTextClass: Record<ArtColor, string> = {
  white: "text-art-white",
  paper: "text-art-paper",
  gray: "text-art-gray",
  muted: "text-art-muted",
  ink: "text-art-ink",
  navy: "text-art-navy",
  green: "text-art-green",
  "green-ink": "text-art-green-ink",
  amber: "text-art-amber",
  red: "text-art-red",
  "red-ink": "text-art-red-ink",
  blue: "text-art-blue",
};

/** A solid fill in an art color, for a dot or a mark. */
export const artFillClass: Record<ArtColor, string> = {
  white: "bg-art-white",
  paper: "bg-art-paper",
  gray: "bg-art-gray",
  muted: "bg-art-muted",
  ink: "bg-art-ink",
  navy: "bg-art-navy",
  green: "bg-art-green",
  "green-ink": "bg-art-green-ink",
  amber: "bg-art-amber",
  red: "bg-art-red",
  "red-ink": "bg-art-red-ink",
  blue: "bg-art-blue",
};

/** A 2px ring in an art color around a surface, for a state marked round a picture. */
export const artRingClass: Record<ArtColor, string> = {
  white: "ring-2 ring-art-white",
  paper: "ring-2 ring-art-paper",
  gray: "ring-2 ring-art-gray",
  muted: "ring-2 ring-art-muted",
  ink: "ring-2 ring-art-ink",
  navy: "ring-2 ring-art-navy",
  green: "ring-2 ring-art-green",
  "green-ink": "ring-2 ring-art-green-ink",
  amber: "ring-2 ring-art-amber",
  red: "ring-2 ring-art-red",
  "red-ink": "ring-2 ring-art-red-ink",
  blue: "ring-2 ring-art-blue",
};

/** A faint wash of an art color with an edge of it, for something in full color that asks for a look. */
export const artTintClass: Record<ArtColor, string> = {
  white: "border border-art-white/45 bg-art-white/7",
  paper: "border border-art-paper/45 bg-art-paper/7",
  gray: "border border-art-gray/45 bg-art-gray/7",
  muted: "border border-art-muted/45 bg-art-muted/7",
  ink: "border border-art-ink/45 bg-art-ink/7",
  navy: "border border-art-navy/45 bg-art-navy/7",
  green: "border border-art-green/45 bg-art-green/7",
  "green-ink": "border border-art-green-ink/45 bg-art-green-ink/7",
  amber: "border border-art-amber/45 bg-art-amber/7",
  red: "border border-art-red/45 bg-art-red/7",
  "red-ink": "border border-art-red-ink/45 bg-art-red-ink/7",
  blue: "border border-art-blue/45 bg-art-blue/7",
};
