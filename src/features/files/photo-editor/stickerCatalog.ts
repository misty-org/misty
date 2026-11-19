import { ellipseGraphicDefinition } from "@opencut/graphics/definitions/ellipse";
import { polygonGraphicDefinition } from "@opencut/graphics/definitions/polygon";
import { rectangleGraphicDefinition } from "@opencut/graphics/definitions/rectangle";
import { starGraphicDefinition } from "@opencut/graphics/definitions/star";
import type { GraphicDefinition } from "@opencut/graphics/types";
import { COUNTRIES } from "@opencut/stickers/providers/countries-data";

/**
 * The stickers a photo can wear: OpenCut's sticker sets (`vendor/opencut/src/stickers`), by the
 * ids OpenCut gives them ("shapes:star", "flags:FR"). Its shapes are its graphics definitions,
 * drawn at any size in the sticker's color; its flags are its bundled flag pictures. OpenCut's
 * logos set is empty in the version vendored, so it isn't offered.
 *
 * This is only the list, with nothing to load, so an edit can be checked anywhere.
 */
export type StickerSetId = "shapes" | "flags";

interface StickerBase {
  /** OpenCut's id: its set, a colon, and the sticker within it. */
  id: string;
  name: string;
  /** Width over height, which a new sticker keeps. */
  aspect: number;
  /** Other words it is found by. */
  keywords: string[];
}
export type ShapeSticker = StickerBase & { set: "shapes"; graphic: GraphicDefinition };
export type FlagSticker = StickerBase & { set: "flags"; code: string };
export type Sticker = ShapeSticker | FlagSticker;

export const stickerSets: { id: StickerSetId; name: string }[] = [
  { id: "shapes", name: "Shapes" },
  { id: "flags", name: "Flags" },
];

/** OpenCut's shapes set lists its graphics definitions, in this order. */
const shapes: ShapeSticker[] = [
  rectangleGraphicDefinition,
  ellipseGraphicDefinition,
  polygonGraphicDefinition,
  starGraphicDefinition,
].map((graphic) => ({
  id: `shapes:${graphic.id}`,
  set: "shapes",
  name: graphic.name,
  aspect: 1,
  keywords: graphic.keywords,
  graphic,
}));

/** OpenCut's flags are all drawn 4:3 (flag-icons' 640 × 480). */
const flags: FlagSticker[] = COUNTRIES.map((country) => {
  const code = country.code.toUpperCase();
  return {
    id: `flags:${code}`,
    set: "flags",
    name: country.name,
    aspect: 4 / 3,
    keywords: [code, ...(country.region ? [country.region] : [])],
    code,
  };
});

export const stickers: Sticker[] = [...shapes, ...flags];

const byId = new Map(stickers.map((sticker) => [sticker.id, sticker]));

/** The sticker an id names, written as OpenCut writes it (a flag's code in capitals). */
export function canonicalStickerId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;
  const set = trimmed.slice(0, colon).toLowerCase();
  const value = trimmed.slice(colon + 1);
  const canonical = set === "flags" ? `flags:${value.toUpperCase()}` : `${set}:${value}`;
  return byId.has(canonical) ? canonical : null;
}

export function stickerById(id: string): Sticker | undefined {
  return byId.get(id);
}

/** The stickers of a set whose name, id or keywords hold the search, in the set's order. */
export function findStickers(set: StickerSetId, search: string): Sticker[] {
  const words = search.trim().toLowerCase();
  return stickers.filter(
    (sticker) =>
      sticker.set === set &&
      (!words ||
        sticker.name.toLowerCase().includes(words) ||
        sticker.id.toLowerCase().includes(words) ||
        sticker.keywords.some((keyword) => keyword.toLowerCase().includes(words))),
  );
}
