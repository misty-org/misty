import {
  isVideoProjectFile,
  loadVideoProjectTools,
  type VideoProjectDocument,
} from "@/features/files";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import type { LocalToolHandler } from "../host";
import { refuse } from "./api";
import { text } from "./args";
import { routedTool } from "./routing";

/**
 * What a video project's footage, or any Media video or sound, holds, without looking at a
 * frame: its shots with their look and what is in them, its loudness and silences, and its
 * beat. Worked out on this computer the first time (in the webview, with the computer's own
 * decoders and image classifier) and kept there after, so a file is analysed once.
 */

const UNAVAILABLE = "Media can't be reached here: the Space's server can't be reached.";
/** The most Media items of one project analysed in one call. */
const MAX_ITEMS = 24;

/** The footage analysis, loaded with OpenCut's core when first used. */
async function loadAnalysis() {
  await loadVideoProjectTools();
  return import("@/features/files/video-editor/analysis");
}

type Analysis = Awaited<ReturnType<typeof loadAnalysis>>;

async function analyseProject(
  analysis: Analysis,
  document: VideoProjectDocument,
  loadMedia: (itemId: string) => Promise<File>,
  signal: AbortSignal,
) {
  const playable = document.media.filter((media) => media.type !== "image");
  const items = playable.slice(0, MAX_ITEMS);
  const analyses = new Map<string, Awaited<ReturnType<Analysis["analyseFootage"]>>>();
  for (const media of items) {
    const file = await loadMedia(media.itemId);
    analyses.set(
      media.itemId,
      await analysis.analyseFootage(file, { visual: media.type === "video", signal }),
    );
  }
  return {
    ...analysis.describeProjectFootage(document, analyses),
    ...(playable.length > items.length && {
      media_left_out: `Only the first ${MAX_ITEMS} media items were analysed.`,
    }),
  };
}

const analyse = routedTool("read", async (request, space) => {
  const itemId = text(request.input, "item_id", { max: 200 }).trim();
  if (!itemId) throw refuse("item_id is required");
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
  let file: File;
  try {
    file = await gateway.libraryFile(space.id, itemId);
  } catch {
    throw refuse(UNAVAILABLE, "unavailable");
  }
  const analysis = await loadAnalysis();
  if (isVideoProjectFile(file.type, file.name)) {
    const video = await gateway.openLibraryVideo(space.id, itemId).catch(() => {
      throw refuse("The video project can't be read.");
    });
    try {
      const document = await video.read();
      return {
        item_id: itemId,
        kind: "project",
        name: video.name,
        ...(await analyseProject(analysis, document, video.loadMedia, request.signal)),
      };
    } finally {
      video.close();
    }
  }
  const sound = analysis.isSoundFile(file);
  if (!sound && !file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name))
    throw refuse("This Media item is neither a video project nor a video or a sound.");
  const found = await analysis.analyseFootage(file, { visual: !sound, signal: request.signal });
  if (!found.visual && !found.audio)
    throw refuse(`“${file.name}” can't be decoded on this computer.`, "unavailable");
  return {
    item_id: itemId,
    kind: sound ? "audio" : "video",
    name: file.name,
    ...analysis.describeFootage(found),
  };
});

export const videoAnalysisTool: LocalToolHandler = analyse;
