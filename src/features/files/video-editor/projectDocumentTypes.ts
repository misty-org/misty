/**
 * A video project kept in a Space: an item in Media of its own type, holding OpenCut's project
 * as it stores it, and for each media file on its timeline, the Space item it comes from. The
 * project points at Media items; it never copies them.
 */
export const VIDEO_PROJECT_MIME = "application/vnd.misty.video+json";
export const VIDEO_PROJECT_EXTENSION = ".mistyvideo";

/** One media file a project uses: the asset id on its timeline, and the Media item it is. */
export interface VideoProjectMedia {
  assetId: string;
  itemId: string;
  name: string;
  type: "video" | "image" | "audio";
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  hasAudio?: boolean;
}

export interface VideoProjectDocument {
  kind: "misty.video";
  version: 1;
  /** The project as OpenCut stores it, or null for a new video that has nothing in it yet. */
  project: unknown;
  media: VideoProjectMedia[];
}

/** A new, empty video project. */
export function emptyVideoProject(): VideoProjectDocument {
  return { kind: "misty.video", version: 1, project: null, media: [] };
}

const mediaTypes = new Set(["video", "image", "audio"]);

function isMedia(value: unknown): value is VideoProjectMedia {
  if (!value || typeof value !== "object") return false;
  const media = value as Record<string, unknown>;
  return (
    typeof media.assetId === "string" &&
    typeof media.itemId === "string" &&
    typeof media.name === "string" &&
    typeof media.type === "string" &&
    mediaTypes.has(media.type)
  );
}

/** Reads a project file's text; throws when it isn't a video project Misty can open. */
export function parseVideoProject(text: string): VideoProjectDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This video project can't be read.");
  }
  const document = value as Partial<VideoProjectDocument> | null;
  if (!document || document.kind !== "misty.video" || document.version !== 1)
    throw new Error("This video project can't be read.");
  if (!Array.isArray(document.media) || !document.media.every(isMedia))
    throw new Error("This video project lists media it can't find.");
  const project = document.project ?? null;
  if (project !== null) {
    const metadata = (project as { metadata?: { id?: unknown } }).metadata;
    if (typeof metadata?.id !== "string") throw new Error("This video project can't be read.");
  }
  return { kind: "misty.video", version: 1, project, media: document.media };
}

/** Whether a Media item is a video project, by its type or its name. */
export function isVideoProjectFile(mimeType: string, filename: string): boolean {
  return (
    mimeType === VIDEO_PROJECT_MIME || filename.toLowerCase().endsWith(VIDEO_PROJECT_EXTENSION)
  );
}
