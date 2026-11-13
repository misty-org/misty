import { invoke } from "@tauri-apps/api/core";
import { pickSaveFile } from "@/native/sandbox";
import { sceneAudioBytes } from "../tutorAudio";
import type { Guide, VideoScene } from "../tutorTypes";

/**
 * A video overview as a file: each scene's illustration drawn on a canvas with its
 * caption, the narration mixed under it, recorded as it plays. Everything happens on this computer.
 */

export const width = 1280;
export const height = 720;
const fade = 0.45;

/** How long a scene runs: its narration, or reading pace when it has no voice. */
export function sceneSeconds(scene: VideoScene): number {
  if (scene.seconds && scene.seconds > 0) return scene.seconds + 0.6;
  const words = scene.narration.split(/\s+/).filter(Boolean).length;
  return Math.max(4, words / 2.6 + 1.5);
}

export function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function loadImage(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

/** Lines of `text` that fit in `max` pixels at the context's font. */
export function wrap(context: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawScene(
  context: CanvasRenderingContext2D,
  scene: VideoScene,
  image: CanvasImageSource | null,
  alpha: number,
) {
  context.globalAlpha = alpha;
  context.fillStyle = "#141414";
  context.fillRect(0, 0, width, height);
  if (image) context.drawImage(image, 0, 0, width, height);
  else {
    context.fillStyle = "#f2efe9";
    context.font = "600 52px system-ui, sans-serif";
    wrap(context, scene.heading, width - 200).forEach((line, index) =>
      context.fillText(line, 100, 170 + index * 64),
    );
    context.fillStyle = "#a8a49c";
    context.font = "32px system-ui, sans-serif";
    (scene.points ?? []).forEach((point, index) =>
      context.fillText(`•  ${point}`, 110, 320 + index * 56),
    );
  }
  // The caption band: the narration, as subtitles.
  context.fillStyle = "rgba(10, 10, 10, 0.78)";
  context.fillRect(0, height - 120, width, 120);
  context.fillStyle = "#f2efe9";
  context.font = "26px system-ui, sans-serif";
  const lines = wrap(context, scene.narration, width - 160).slice(0, 3);
  lines.forEach((line, index) =>
    context.fillText(line, 80, height - 120 + 38 + index * 32 - (lines.length - 1) * 4),
  );
  context.globalAlpha = 1;
}

function recorderType(): string {
  return (
    [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm",
    ].find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) ??
    ""
  );
}

/** Records the video as it plays, in real time. `onProgress` gets seconds done and in all. */
export async function recordVideo(
  video: Guide,
  onProgress: (done: number, total: number) => void,
): Promise<{ blob: Blob; extension: string }> {
  const scenes = video.scenes ?? [];
  const type = recorderType();
  if (!type) throw new Error("This system can't record video.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Misty couldn't draw the video.");
  const images = await Promise.all(
    scenes.map((scene) => (scene.svg ? loadImage(svgUrl(scene.svg)) : null)),
  );
  const pictures = images;
  const audio = new AudioContext();
  const output = audio.createMediaStreamDestination();
  const voiced = video.audio?.state === "ready";
  const buffers = await Promise.all(
    scenes.map((_, index) =>
      voiced
        ? sceneAudioBytes(video.id, index)
            .then((bytes) => audio.decodeAudioData(bytes))
            .catch(() => null)
        : Promise.resolve(null),
    ),
  );
  const lengths = scenes.map((scene, index) =>
    buffers[index] ? buffers[index]!.duration + 0.6 : sceneSeconds(scene),
  );
  const starts = lengths.map((_, index) =>
    lengths.slice(0, index).reduce((sum, value) => sum + value, 0),
  );
  const total = lengths.reduce((sum, value) => sum + value, 0);

  const stream = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...output.stream.getAudioTracks(),
  ]);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  drawScene(context, scenes[0], pictures[0], 1);
  recorder.start(1000);
  const begin = audio.currentTime + 0.15;
  buffers.forEach((buffer, index) => {
    if (!buffer) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    source.start(begin + starts[index] + 0.3);
  });
  await new Promise<void>((resolve) => {
    const frame = () => {
      const at = audio.currentTime - begin;
      if (at >= total) return resolve();
      const index = Math.max(0, starts.filter((start) => start <= at).length - 1);
      drawScene(context, scenes[index], pictures[index], 1);
      const into = at - starts[index];
      // The next scene fades in over the last moments of this one.
      const left = lengths[index] - into;
      if (left < fade && scenes[index + 1])
        drawScene(context, scenes[index + 1], pictures[index + 1], 1 - left / fade);
      onProgress(Math.min(at, total), total);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  recorder.stop();
  await stopped;
  await audio.close();
  return {
    blob: new Blob(chunks, { type }),
    extension: type.startsWith("video/mp4") ? "mp4" : "webm",
  };
}

/** Asks where to save, then writes the bytes there through the save dialog's grant. */
export async function saveBytes(
  bytes: Blob,
  name: string,
  extension: string,
  kind: string,
): Promise<boolean> {
  const path = await pickSaveFile({
    defaultName: `${name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Notebook"}.${extension}`,
    filters: [{ name: kind, extensions: [extension] }],
  });
  if (!path) return false;
  await invoke("tutor_save_export", new Uint8Array(await bytes.arrayBuffer()), {
    headers: { "x-path": encodeURIComponent(path) },
  });
  return true;
}
