import {
  canEditVideo,
  loadVideoProjectTools,
  VIDEO_EDITING_UNAVAILABLE,
  type VideoProjectDocument,
} from "@/features/files";
import { recognizeAudioWords } from "@/features/voice";
import { spacesGateway, type LiveLibraryVideo } from "../../spaces-gateway/spacesGateway";
import type { LocalToolHandler, LocalToolRequest } from "../host";
import { refuse } from "./api";
import { text } from "./args";
import { routedTool, type SpaceRow } from "./routing";
import { noteBeforeVideoChange } from "./videoTurns";

/**
 * An agent working on a video project in the Space's Media: it reads the project, edits it as
 * data, looks at frames of it, listens to it, and renders it. Each change is kept as a new
 * version of the project's file and lands in the open editors at once, through the project's
 * live room. The editor doesn't need to be open.
 */

const UNAVAILABLE = "Video projects can't be reached here: the Space's server can't be reached.";
const VIEW_ONLY = "This video can only be viewed here, not edited.";
/** The export sizes `video.export` takes, as the editor's export offers them (export/sizes.ts). */
const EXPORT_SIZES = [
  "project",
  "720p",
  "1080p",
  "1440p",
  "4k",
  "vertical",
  "square",
  "widescreen",
] as const;
/** The most frames one look returns. */
const MAX_FRAMES = 8;

const itemId = (input: Record<string, unknown>) => {
  const id = text(input, "item_id", { max: 200 }).trim();
  if (!id) throw refuse("item_id is required");
  return id;
};

async function withVideo<T>(
  request: LocalToolRequest,
  space: SpaceRow,
  work: (video: LiveLibraryVideo) => Promise<T>,
): Promise<T> {
  if (!canEditVideo()) throw refuse(VIDEO_EDITING_UNAVAILABLE, "unavailable");
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
  let video: LiveLibraryVideo;
  try {
    video = await gateway.openLibraryVideo(space.id, itemId(request.input));
  } catch (error) {
    if (error instanceof Error && error.message === "This Media item isn't a video project.")
      throw refuse(error.message);
    throw refuse(UNAVAILABLE, "unavailable");
  }
  try {
    return await work(video);
  } finally {
    video.close();
  }
}

/** Reads a project, failing as a refusal the agent can act on. */
async function readProject(video: LiveLibraryVideo): Promise<VideoProjectDocument> {
  try {
    return await video.read();
  } catch (error) {
    throw refuse(error instanceof Error ? error.message : "The video project can't be read.");
  }
}

const read = routedTool("read", (request, space) =>
  withVideo(request, space, async (video) => {
    const tools = await loadVideoProjectTools();
    return { name: video.name, ...tools.describeVideoProject(await readProject(video)) };
  }),
);

const edit = routedTool("change", (request, space) =>
  withVideo(request, space, async (video) => {
    if (video.role === "viewer") throw refuse(VIEW_ONLY, "not_allowed");
    const edits = request.input.edits;
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > 200)
      throw refuse("edits must be a list of 1 to 200 edits");
    const tools = await loadVideoProjectTools();
    const before = await readProject(video);
    let after: VideoProjectDocument;
    try {
      after = await tools.editVideoProject(
        before,
        edits as Parameters<typeof tools.editVideoProject>[1],
        video.loadMedia,
      );
    } catch (error) {
      throw refuse(error instanceof Error ? error.message : "The edit could not be made.");
    }
    noteBeforeVideoChange(request.runId, space.id, itemId(request.input), before);
    await video.keep(after);
    return { edited: edits.length, ...tools.describeVideoProject(after) };
  }),
);

const frames = routedTool("read", (request, space) =>
  withVideo(request, space, async (video) => {
    const at = request.input.at;
    if (
      !Array.isArray(at) ||
      at.length === 0 ||
      at.length > MAX_FRAMES ||
      !at.every((value) => typeof value === "number")
    )
      throw refuse(`at must be a list of 1 to ${MAX_FRAMES} times, in seconds`);
    const tools = await loadVideoProjectTools();
    const rendered = await tools.renderFrames(
      await readProject(video),
      at as number[],
      video.loadMedia,
    );
    return {
      frames: rendered.length,
      displayCaptures: rendered.map((frame) => ({
        name: `${video.name} at ${frame.at}s`,
        width: frame.width,
        height: frame.height,
        dataUrl: frame.dataUrl,
      })),
    };
  }),
);

const transcript = routedTool("read", (request, space) =>
  withVideo(request, space, async (video) => {
    const tools = await loadVideoProjectTools();
    const audio = await tools.timelineAudio(await readProject(video), video.loadMedia);
    try {
      const words = await recognizeAudioWords(audio);
      return { words: words.map(({ text: said, start, end }) => ({ text: said, start, end })) };
    } catch (error) {
      throw refuse(
        error instanceof Error ? error.message : "Speech in this video could not be recognized.",
        "unavailable",
      );
    }
  }),
);

const exported = routedTool("change", (request, space) =>
  withVideo(request, space, async (video) => {
    const gateway = spacesGateway.maybe();
    if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
    const name = text(request.input, "name", { max: 200 }).trim() || video.name;
    const format = text(request.input, "format", { allowed: ["mp4", "webm"] }) || "mp4";
    const quality =
      text(request.input, "quality", { allowed: ["low", "medium", "high", "very_high"] }) || "high";
    const size = text(request.input, "size", { allowed: EXPORT_SIZES }) || "project";
    const tools = await loadVideoProjectTools();
    const document = await readProject(video);
    let blob: Blob;
    try {
      // A size this video's shape or this computer can't take is the agent's to change.
      blob = await tools.exportVideoProject(document, video.loadMedia, {
        format: format as "mp4" | "webm",
        quality: quality as "low" | "medium" | "high" | "very_high",
        size: size as (typeof EXPORT_SIZES)[number],
      });
    } catch (error) {
      throw refuse(error instanceof Error ? error.message : "The video could not be rendered.");
    }
    const filename = `${name.replace(/\.(mp4|webm)$/i, "")}.${format}`;
    const result = await gateway.uploadLibraryBlob(space.id, blob, filename, "library");
    return { saved: filename, item_id: result.item?.id ?? null, bytes: blob.size };
  }),
);

export const videoTools: Record<string, LocalToolHandler> = {
  "video.read": read,
  "video.edit": edit,
  "video.frames": frames,
  "video.transcript": transcript,
  "video.export": exported,
};
