import type { TimelineElement } from "@opencut/timeline";
import type { VideoProjectDocument } from "../projectDocumentTypes";
import { sourceSpanOf } from "../tools/beatCuts";
import { allTracks, itemOf, projectOf, sceneOf, seconds } from "../tools/projectModel";
import type { FootageAnalysis, FootageColor, FootageScene } from "./types";

/*
 * Analyses as agents read them (`video.analysis`): rounded, with every list capped, so a long
 * video still answers in a few thousand words. Like the rest of the project model, this reads
 * OpenCut's modules, so it loads after OpenCut's core.
 */

interface Limits {
  scenes: number;
  beats: number;
  loudness: number;
  silences: number;
}

const ONE_ITEM: Limits = { scenes: 80, beats: 240, loudness: 200, silences: 80 };
/** Each item of a project gets less, since a project lists several. */
const IN_PROJECT: Limits = { scenes: 40, beats: 160, loudness: 100, silences: 40 };
/** The most scenes listed under one clip. */
const SCENES_PER_CLIP = 12;

const round = (value: number, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** The largest value, without spreading a long list into arguments. */
const largest = (values: number[], empty: number) =>
  values.reduce((most, value) => (value > most ? value : most), values.length ? -Infinity : empty);

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

function look(color: FootageColor) {
  return {
    brightness: round(color.brightness),
    contrast: round(color.contrast),
    warmth: round(color.warmth),
    tint: round(color.tint),
    saturation: round(color.saturation),
  };
}

/** The whole video's look: its scenes' looks, each counted by its length. */
function overallLook(scenes: FootageScene[]): FootageColor {
  const total = { brightness: 0, contrast: 0, warmth: 0, tint: 0, saturation: 0 };
  let length = 0;
  for (const scene of scenes) {
    const weight = scene.end - scene.start;
    length += weight;
    for (const key of Object.keys(total) as Array<keyof FootageColor>)
      total[key] += scene[key] * weight;
  }
  for (const key of Object.keys(total) as Array<keyof FootageColor>)
    total[key] /= Math.max(1e-9, length);
  return total;
}

const labelsOf = (scene: FootageScene) =>
  scene.labels?.length
    ? Object.fromEntries(scene.labels.map((each) => [each.label, round(each.confidence)]))
    : undefined;

/** Loudness in at most `limit` readings, each the loudest of the steps it stands for. */
function loudnessCurve(loudness: number[], step: number, limit: number) {
  const group = Math.max(1, Math.ceil(loudness.length / limit));
  const db: number[] = [];
  for (let i = 0; i < loudness.length; i += group)
    db.push(Math.round(largest(loudness.slice(i, i + group), -90)));
  const finite = loudness.filter((value) => value > -90);
  const mean = finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : -90;
  return {
    step: round(step * group),
    db,
    mean_db: round(mean, 1),
    peak_db: round(largest(loudness, -90), 1),
  };
}

/** One media file's analysis as an agent reads it. */
export function describeFootage(analysis: FootageAnalysis, limits: Limits = ONE_ITEM) {
  const { visual, audio } = analysis;
  const described: Record<string, unknown> = { duration: round(analysis.duration) };
  if (visual) {
    const shots = visual.scenes.map((scene) => scene.end - scene.start);
    described.size = { width: visual.width, height: visual.height };
    described.pacing = {
      scenes: visual.scenes.length,
      average_shot: round(visual.duration / Math.max(1, visual.scenes.length)),
      median_shot: round(median(shots)),
      shortest_shot: round(
        -largest(
          shots.map((shot) => -shot),
          0,
        ),
      ),
      longest_shot: round(largest(shots, 0)),
      cuts_per_minute: round(
        (Math.max(0, visual.scenes.length - 1) * 60) / Math.max(1, visual.duration),
        1,
      ),
    };
    described.look = look(overallLook(visual.scenes));
    described.scenes = visual.scenes.slice(0, limits.scenes).map((scene) => {
      const labels = labelsOf(scene);
      return {
        start: round(scene.start),
        end: round(scene.end),
        ...(labels && { labels }),
        ...look(scene),
      };
    });
    if (visual.scenes.length > limits.scenes) described.scenes_total = visual.scenes.length;
    if (!visual.labelled) described.labels = "not available on this computer";
  }
  if (!audio) {
    described.sound = false;
    return described;
  }
  described.loudness = loudnessCurve(audio.loudness, audio.step, limits.loudness);
  described.silence_below_db = audio.silenceThreshold;
  described.silences = audio.silences.slice(0, limits.silences);
  if (audio.silences.length > limits.silences) described.silences_total = audio.silences.length;
  described.beats = audio.beats
    ? {
        tempo: audio.beats.tempo,
        confidence: audio.beats.confidence,
        count: audio.beats.times.length,
        times: audio.beats.times.slice(0, limits.beats).map((time) => round(time)),
      }
    : null;
  return described;
}

const trackKind = (track: { id: string; type: string }, mainId: string) =>
  track.id === mainId ? "main" : track.type === "audio" ? "audio" : "overlay";

/** The scenes a clip shows, moved to where they play on the timeline. */
function scenesInClip(element: TimelineElement, analysis: FootageAnalysis | undefined) {
  const scenes = analysis?.visual?.scenes;
  if (!scenes?.length) return undefined;
  const { start, end, sourceStart, sourceEnd, rate } = sourceSpanOf(element);
  const toTimeline = (time: number) => start + (time - sourceStart) / (rate || 1);
  const shown = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => scene.end > sourceStart && scene.start < sourceEnd)
    .slice(0, SCENES_PER_CLIP)
    .map(({ scene, index }) => ({
      scene: index,
      start: round(Math.max(start, toTimeline(scene.start))),
      end: round(Math.min(end, toTimeline(scene.end))),
      ...(scene.labels?.length
        ? { labels: scene.labels.slice(0, 3).map((each) => each.label) }
        : {}),
    }));
  return shown.length ? shown : undefined;
}

/**
 * A video project's footage as an agent reads it: each clip's place on the timeline with the
 * scenes it shows, and each Media item's own analysis (keyed by item id), whose times are in
 * that item.
 */
export function describeProjectFootage(
  document: VideoProjectDocument,
  analyses: ReadonlyMap<string, FootageAnalysis>,
) {
  const media = Object.fromEntries(
    [...analyses].map(([itemId, analysis]) => [itemId, describeFootage(analysis, IN_PROJECT)]),
  );
  if (document.project === null) return { duration: 0, clips: [], media };
  const scene = sceneOf(projectOf(document));
  const mainId = scene.tracks.main.id;
  const clips = allTracks(scene.tracks).flatMap((track) =>
    (track.elements as TimelineElement[]).flatMap((element) => {
      const itemId = itemOf(document, element);
      if (!itemId) return [];
      const span = sourceSpanOf(element);
      const shown = scenesInClip(element, analyses.get(itemId));
      return [
        {
          element_id: element.id,
          item_id: itemId,
          track: trackKind(track, mainId),
          start: round(span.start),
          end: round(span.end),
          source_start: round(span.sourceStart),
          source_end: round(span.sourceEnd),
          ...(Math.abs(span.rate - 1) > 0.01 && { speed: round(span.rate) }),
          ...(shown && { scenes: shown }),
        },
      ];
    }),
  );
  const ends = allTracks(scene.tracks).flatMap((track) =>
    (track.elements as TimelineElement[]).map((element) =>
      seconds(element.startTime + element.duration),
    ),
  );
  return { duration: round(largest(ends, 0)), clips, media };
}
