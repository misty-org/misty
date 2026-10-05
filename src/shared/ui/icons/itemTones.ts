/**
 * Glyph colors for item-type icons on content surfaces: the file explorer and collection rows
 * and cards. A tone says what an item is, never its state; tiles, hover,
 * selection and focus stay monochrome. Navbar, sidebars and browser chrome stay uncolored.
 */
export type ItemTone =
  "blue" | "red" | "green" | "orange" | "violet" | "pink" | "amber" | "teal" | "sand";

// Literal class names so Tailwind picks them up.
const toneClasses: Record<ItemTone, string> = {
  blue: "text-tone-blue",
  red: "text-tone-red",
  green: "text-tone-green",
  orange: "text-tone-orange",
  violet: "text-tone-violet",
  pink: "text-tone-pink",
  amber: "text-tone-amber",
  teal: "text-tone-teal",
  sand: "text-tone-sand",
};

/** One tone per kind of thing, shared by every surface so a PDF or a note looks the same everywhere. */
export const itemTones = {
  document: "blue",
  note: "blue",
  pdf: "red",
  sheet: "green",
  slides: "orange",
  image: "violet",
  drawing: "violet",
  font: "violet",
  media: "pink",
  archive: "amber",
  code: "teal",
  data: "teal",
  folder: "sand",
  chat: "teal",
  task: "orange",
  event: "red",
  milestone: "violet",
  schedule: "amber",
  activity: "sand",
} as const satisfies Record<string, ItemTone>;

export function itemToneClass(tone: ItemTone): string {
  return toneClasses[tone];
}
