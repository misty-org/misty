import type { LibraryAssetStack, SpaceLibraryItem } from "@/services/spaces/dto/interfaces/types";
import type { LibraryAssetStackInput } from "@/services/spaces/dto/types/SpaceLibraryPrimitives";
import { isLibraryRAW, libraryItemMIME } from "./libraryMediaTypes";

const MAX_BURST_FRAMES = 100;
const BURST_FILENAME = /^(.*?)[_-]burst[_-]?(?:\d+)(?:[_-](?:cover|key))?$/i;

/**
 * Validates a selection as a stack of the given kind, or returns null.
 *
 * Each kind has a fixed shape: a Live Photo is exactly one image plus one
 * video, a RAW pair is one RAW plus one rendered image, and a burst is two or
 * more images.
 */
export function buildLibraryAssetStack(
  kind: LibraryAssetStack["kind"],
  items: SpaceLibraryItem[],
): LibraryAssetStackInput | null {
  if (kind === "live_photo") {
    if (items.length !== 2) return null;
    const still = items.find((item) => libraryItemMIME(item).startsWith("image/"));
    const motion = items.find((item) => libraryItemMIME(item).startsWith("video/"));
    if (!still || !motion) return null;
    return {
      kind,
      title: "",
      cover_item_id: still.id,
      motion_item_id: motion.id,
      members: [
        { item_id: still.id, role: "still", position: 0 },
        { item_id: motion.id, role: "motion", position: 1 },
      ],
    };
  }

  if (kind === "raw_pair") {
    if (items.length !== 2) return null;
    const raw = items.find((item) => isLibraryRAW(item.file.original_filename));
    const rendered = items.find(
      (item) => item.id !== raw?.id && libraryItemMIME(item).startsWith("image/"),
    );
    if (!raw || !rendered) return null;
    return {
      kind,
      title: "",
      cover_item_id: rendered.id,
      members: [
        { item_id: rendered.id, role: "alternate", position: 0 },
        { item_id: raw.id, role: "raw", position: 1 },
      ],
    };
  }

  if (
    items.length < 2 ||
    items.length > MAX_BURST_FRAMES ||
    items.some((item) => !libraryItemMIME(item).startsWith("image/"))
  )
    return null;
  return {
    kind,
    title: "",
    cover_item_id: items[0].id,
    members: items.map((item, position) => ({
      item_id: item.id,
      role: "burst_frame" as const,
      position,
    })),
  };
}

/**
 * Guesses which freshly uploaded files belong together.
 *
 * Live Photos and RAW pairs are matched by shared filename stem — the camera
 * writes `IMG_1234.HEIC` and `IMG_1234.MOV` — while bursts are matched by the
 * `_burst_N` suffix cameras append.
 */
export function detectUploadedAssetStacks(items: SpaceLibraryItem[]): LibraryAssetStackInput[] {
  const result: LibraryAssetStackInput[] = [];
  const byStem = new Map<string, SpaceLibraryItem[]>();
  const bursts = new Map<string, SpaceLibraryItem[]>();

  for (const item of items) {
    const filename = item.file.original_filename;
    const withoutExtension = filename.replace(/\.[^.]+$/, "");
    const stem = withoutExtension.toLocaleLowerCase();
    byStem.set(stem, [...(byStem.get(stem) ?? []), item]);
    const burstMatch = withoutExtension.match(BURST_FILENAME);
    if (burstMatch) {
      const key = burstMatch[1].toLocaleLowerCase();
      bursts.set(key, [...(bursts.get(key) ?? []), item]);
    }
  }

  for (const grouped of byStem.values()) {
    const live = buildLibraryAssetStack("live_photo", grouped);
    if (live) result.push(live);
    const rawPair = buildLibraryAssetStack("raw_pair", grouped);
    if (rawPair) result.push(rawPair);
  }
  for (const grouped of bursts.values()) {
    const burst = buildLibraryAssetStack("burst", grouped);
    if (burst) result.push(burst);
  }
  return result;
}
