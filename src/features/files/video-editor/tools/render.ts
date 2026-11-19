import { loadFonts } from "@opencut/fonts/google-fonts";
import { createTimelineAudioBuffer } from "@opencut/media/audio";
import { extractTimelineAudio } from "@opencut/media/mediabunny";
import type { MediaAsset } from "@opencut/media/types";
import { CanvasRenderer } from "@opencut/services/renderer/canvas-renderer";
import { initializeGpuRenderer } from "@opencut/services/renderer/gpu-renderer";
import { buildScene } from "@opencut/services/renderer/scene-builder";
import { SceneExporter } from "@opencut/services/renderer/scene-exporter";
import type { SceneTracks } from "@opencut/timeline";
import { getElementFontFamilies } from "@opencut/timeline/element-utils";
import { getExportMimeType, type ExportFormat, type ExportQuality } from "@opencut/export";
import {
  canEncodeExportSize,
  EXPORT_SIZE_LABELS,
  exportSizeMismatch,
  resolveExportSize,
  type ExportSize,
} from "@opencut/export/sizes";
import type { VideoProjectDocument } from "../projectDocumentTypes";
import { durationOf, projectOf, sceneOf, ticks } from "./projectModel";

/** A project ready to draw: its scene, its media read from the Space, and what to let go after. */
interface Materialized {
  tracks: SceneTracks;
  media: MediaAsset[];
  duration: number;
  canvas: { width: number; height: number };
  fps: ReturnType<typeof projectOf>["settings"]["fps"];
  background: ReturnType<typeof projectOf>["settings"]["background"];
  release(): void;
}

async function materialize(
  document: VideoProjectDocument,
  loadMedia: (itemId: string) => Promise<File>,
): Promise<Materialized> {
  const project = projectOf(document);
  const { tracks } = sceneOf(project);
  const urls: string[] = [];
  const media = await Promise.all(
    document.media.map(async (entry): Promise<MediaAsset> => {
      const file = await loadMedia(entry.itemId);
      const url = URL.createObjectURL(file);
      urls.push(url);
      return {
        id: entry.assetId,
        name: entry.name,
        type: entry.type,
        width: entry.width,
        height: entry.height,
        duration: entry.duration,
        fps: entry.fps,
        hasAudio: entry.hasAudio,
        file,
        url,
      };
    }),
  );
  await loadFonts({ families: getElementFontFamilies({ tracks }) });
  return {
    tracks,
    media,
    duration: durationOf(tracks),
    canvas: project.settings.canvasSize,
    fps: project.settings.fps,
    background: project.settings.background,
    release: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  };
}

/**
 * The video drawn at each of the given moments (seconds), every track and effect included, as
 * PNG data URLs no wider than `width`.
 */
export async function renderFrames(
  document: VideoProjectDocument,
  at: number[],
  loadMedia: (itemId: string) => Promise<File>,
  width = 640,
): Promise<Array<{ at: number; dataUrl: string; width: number; height: number }>> {
  await initializeGpuRenderer();
  const ready = await materialize(document, loadMedia);
  try {
    const scene = buildScene({ ...ready, canvasSize: ready.canvas, mediaAssets: ready.media });
    const renderer = new CanvasRenderer({ ...ready.canvas, fps: ready.fps });
    const frames = [];
    for (const time of at) {
      const full = window.document.createElement("canvas");
      full.width = ready.canvas.width;
      full.height = ready.canvas.height;
      await renderer.renderToCanvas({
        node: scene,
        time: Math.min(Math.max(0, ticks(time)), Math.max(0, ready.duration - 1)),
        targetCanvas: full,
      });
      const scale = Math.min(1, width / full.width);
      const small = window.document.createElement("canvas");
      small.width = Math.round(full.width * scale);
      small.height = Math.round(full.height * scale);
      small.getContext("2d")?.drawImage(full, 0, 0, small.width, small.height);
      frames.push({
        at: time,
        dataUrl: small.toDataURL("image/png"),
        width: small.width,
        height: small.height,
      });
    }
    return frames;
  } finally {
    ready.release();
  }
}

/** Everything the video sounds like, mixed as a WAV recording, for listening to its speech. */
export async function timelineAudio(
  document: VideoProjectDocument,
  loadMedia: (itemId: string) => Promise<File>,
): Promise<Blob> {
  const ready = await materialize(document, loadMedia);
  try {
    return await extractTimelineAudio({
      tracks: ready.tracks,
      mediaAssets: ready.media,
      totalDuration: ready.duration,
    });
  } finally {
    ready.release();
  }
}

/**
 * The finished video, rendered with sound as the editor's Export renders it, at the project's
 * size or another of the same shape (`size`, as the editor's export offers: 720p to 4K by the
 * short side, or a platform's frame when the project has its shape).
 */
export async function exportVideoProject(
  document: VideoProjectDocument,
  loadMedia: (itemId: string) => Promise<File>,
  options: { format: ExportFormat; quality: ExportQuality; size?: ExportSize },
): Promise<Blob> {
  const size = options.size ?? "project";
  const canvas = projectOf(document).settings.canvasSize;
  const mismatch = exportSizeMismatch({ size, canvas });
  if (mismatch) throw new Error(mismatch);
  const frame = resolveExportSize({ size, canvas }) ?? canvas;
  if (size !== "project" && !(await canEncodeExportSize({ format: options.format, ...frame })))
    throw new Error(
      `This computer can't encode a ${EXPORT_SIZE_LABELS[size]} (${frame.width}×${frame.height}) ${options.format} video; choose a smaller size.`,
    );
  await initializeGpuRenderer();
  const ready = await materialize(document, loadMedia);
  try {
    if (ready.duration === 0) throw new Error("This video is empty.");
    const audioBuffer = await createTimelineAudioBuffer({
      tracks: ready.tracks,
      mediaAssets: ready.media,
      duration: ready.duration,
    });
    const scene = buildScene({ ...ready, canvasSize: ready.canvas, mediaAssets: ready.media });
    const exporter = new SceneExporter({
      ...ready.canvas,
      fps: ready.fps,
      format: options.format,
      quality: options.quality,
      shouldIncludeAudio: Boolean(audioBuffer),
      audioBuffer: audioBuffer ?? undefined,
      ...(size !== "project" && { outputSize: { width: frame.width, height: frame.height } }),
    });
    const buffer = await exporter.export({ rootNode: scene });
    if (!buffer) throw new Error("The video could not be rendered.");
    return new Blob([buffer], { type: getExportMimeType({ format: options.format }) });
  } finally {
    ready.release();
  }
}
