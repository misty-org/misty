import { processMediaAssets } from "@opencut/media/processing";
import type { AudioTrack, SceneTracks, TimelineElement } from "@opencut/timeline";
import { generateUUID } from "@opencut/utils/id";
import { analyseFootage } from "../analysis/analyse";
import type { AudioAnalysis } from "../analysis/types";
import type { VideoProjectDocument } from "../projectDocumentTypes";
import { beatsOnTimeline, cutToBeatTimes } from "./beatCuts";
import type { DocumentEditHandler, EditContext } from "./documentEdits";
import { DEFAULT_MUSIC_DB, layMusic, speechIn, type SoundSource } from "./music";
import { allTracks, copyDocument, itemOf, projectOf, sceneOf } from "./projectModel";

/*
 * The edits that listen to the footage: cutting the main track to a sound's beat, and putting
 * music under the video, ducked under its speech. Both read the media's analysis, worked out on
 * this computer the first time and kept after (`../analysis`).
 */

/** Moves the main track's cuts to the nearest beats of a sound (the project's music by default). */
export type CutToBeatsEdit = {
  op: "cut_to_beats";
  /** The Media item whose beat to cut to; where it is in the video, as it plays there. */
  audio_item_id?: string;
  /** Or the clip whose beat to cut to. */
  element_id?: string;
  /** Cut on every beat (1), every other beat (2) or once a bar (4). */
  every?: 1 | 2 | 4;
};

/** Puts a Media sound under the video: to its length, faded out, ducked under speech. */
export type AddMusicEdit = {
  op: "add_music";
  item_id: string;
  /** The music's level where nobody speaks, in dB (0 is the sound as recorded). */
  volume?: number;
  /** Whether it dips under speech; it does unless this is false. */
  duck?: boolean;
};

export type BeatEdit = CutToBeatsEdit | AddMusicEdit;

function fail(message: string): never {
  throw new Error(message);
}

async function soundOf(context: EditContext, itemId: string): Promise<AudioAnalysis | null> {
  const analysis = await analyseFootage(await context.loadMedia(itemId), { visual: false });
  return analysis.audio;
}

const nameOf = (document: VideoProjectDocument, itemId: string) =>
  document.media.find((media) => media.itemId === itemId)?.name ?? "this sound";

const playedLength = (track: AudioTrack) =>
  track.elements.reduce((sum, element) => sum + element.duration, 0);

/** The sound whose beat to cut to, and the clips that play it in the video. */
function beatSource(
  document: VideoProjectDocument,
  tracks: SceneTracks,
  edit: CutToBeatsEdit,
): { itemId: string; elements: TimelineElement[] } {
  const everything = allTracks(tracks).flatMap((track) => track.elements as TimelineElement[]);
  if (edit.element_id) {
    const element =
      everything.find((candidate) => candidate.id === edit.element_id) ??
      fail(`There is no clip ${edit.element_id} in this video; video_read lists them.`);
    const itemId =
      itemOf(document, element) ?? fail(`Clip ${edit.element_id} plays no sound from Media.`);
    return { itemId, elements: [element] };
  }
  if (edit.audio_item_id) {
    const itemId = edit.audio_item_id;
    return {
      itemId,
      elements: everything.filter((element) => itemOf(document, element) === itemId),
    };
  }
  // The project's music: the audio track that plays the most, and the sound it plays most.
  const track = tracks.audio
    .filter((candidate) => candidate.elements.some((element) => itemOf(document, element)))
    .sort((a, b) => playedLength(b) - playedLength(a))[0];
  if (!track)
    fail(
      "There's no music in this video to cut to: add some first (add_music), or name audio_item_id.",
    );
  const played = new Map<string, number>();
  for (const element of track.elements) {
    const itemId = itemOf(document, element);
    if (itemId) played.set(itemId, (played.get(itemId) ?? 0) + element.duration);
  }
  const [itemId] = [...played].sort((a, b) => b[1] - a[1])[0];
  return {
    itemId,
    elements: track.elements.filter((element) => itemOf(document, element) === itemId),
  };
}

export const cutToBeats: DocumentEditHandler<CutToBeatsEdit> = async (document, edit, context) => {
  const every = edit.every ?? 1;
  if (every !== 1 && every !== 2 && every !== 4) fail("every is 1, 2 or 4.");
  const next = copyDocument(document);
  const project = projectOf(next);
  const scene = sceneOf(project);
  const source = beatSource(next, scene.tracks, edit);
  const beats = (await soundOf(context, source.itemId))?.beats?.times;
  if (!beats || beats.length < 4)
    fail(`No steady beat was found in ${nameOf(next, source.itemId)}.`);
  // Beats where the sound plays in the video, or from its start when it isn't in it.
  const times = source.elements.length
    ? source.elements.flatMap((element) => beatsOnTimeline(element, beats)).sort((a, b) => a - b)
    : beats;
  const playing = new Set(source.elements.map((element) => element.id));
  const anchored = new Set(
    allTracks(scene.tracks)
      .filter((track) => (track.elements as TimelineElement[]).some((each) => playing.has(each.id)))
      .map((track) => track.id),
  );
  scene.tracks = cutToBeatTimes(scene.tracks, times, {
    every,
    fps: project.settings.fps,
    anchored,
  });
  return next;
};

/** How the speech in a project's clips is found: each media's own sound, analysed. */
function projectSounds(document: VideoProjectDocument, context: EditContext) {
  return (mediaId: string): SoundSource | undefined => {
    const media = document.media.find((each) => each.assetId === mediaId);
    if (!media) return undefined;
    return {
      hasSound: media.type === "audio" || (media.type === "video" && media.hasAudio !== false),
      analyse: () => soundOf(context, media.itemId),
    };
  };
}

export const addMusic: DocumentEditHandler<AddMusicEdit> = async (document, edit, context) => {
  const itemId = typeof edit.item_id === "string" ? edit.item_id.trim() : "";
  if (!itemId) fail("add_music needs item_id: a sound in Media.");
  if (
    edit.volume !== undefined &&
    (typeof edit.volume !== "number" || !Number.isFinite(edit.volume))
  )
    fail("volume takes a number of dB (0 is the sound as recorded, -8 sits under speech).");
  const next = copyDocument(document);
  const scene = sceneOf(projectOf(next));
  const file = await context.loadMedia(itemId);
  const [probed] = await processMediaAssets({ files: [file] });
  if (!probed || probed.type !== "audio")
    fail(`“${file.name}” isn't a sound: add_music takes an audio file from Media.`);
  const known = next.media.find((media) => media.itemId === itemId);
  const assetId = known?.assetId ?? generateUUID();
  if (!known)
    next.media = [
      ...next.media,
      {
        assetId,
        itemId,
        name: probed.name,
        type: "audio",
        ...(probed.duration !== undefined && { duration: probed.duration }),
      },
    ];
  const audio = (await analyseFootage(file, { visual: false })).audio;
  const duration = probed.duration ?? audio?.duration ?? 0;
  const speech =
    edit.duck === false ? [] : await speechIn(scene.tracks, projectSounds(next, context));
  scene.tracks = layMusic(scene.tracks, {
    mediaId: assetId,
    name: probed.name,
    duration,
    beats: audio?.beats?.times ?? null,
    volume: edit.volume ?? DEFAULT_MUSIC_DB,
    speech,
  });
  return next;
};
