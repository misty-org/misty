import { useEffect } from "react";
import { EditorCore } from "@opencut/core";
import { TracksSnapshotCommand } from "@opencut/commands/timeline";
import { processMediaAssets } from "@opencut/media/processing";
import type { MediaAsset } from "@opencut/media/types";
import { setMusicTools, type MusicSound, type MusicTools } from "@opencut/sounds/music-tools";
import type { SceneTracks, TimelineElement } from "@opencut/timeline";
import { analyseFootage } from "./analysis/analyse";
import type { AudioAnalysis } from "./analysis/types";
import { beatsOnTimeline, cutToBeatTimes } from "./tools/beatCuts";
import { DEFAULT_MUSIC_DB, layMusic, speechIn, type SoundSource } from "./tools/music";

/*
 * The Sounds tab's "Add as music" and "Cut to the beat", in the open editor: the same work as the
 * agents' add_music and cut_to_beats edits, applied to the editor's timeline as one step to undo.
 * Like the rest of the editor's own code, this reads OpenCut's modules, so it loads after
 * OpenCut's core.
 */

async function soundOf(file: File): Promise<AudioAnalysis | null> {
  return (await analyseFootage(file, { visual: false })).audio;
}

/** The project's media for the sound: the same file, added before. */
function assetOf(editor: EditorCore, sound: MusicSound): MediaAsset | undefined {
  return editor.media
    .getAssets()
    .find(
      (asset) =>
        !asset.ephemeral &&
        asset.type === "audio" &&
        (asset.name === sound.file.name || asset.name === sound.name) &&
        asset.file.size === sound.file.size,
    );
}

/** Changes the timeline from `before` to `after` as one step to undo. */
function apply(editor: EditorCore, before: SceneTracks, after: SceneTracks) {
  editor.command.execute({ command: new TracksSnapshotCommand({ before, after }) });
}

/** How the speech in the open project's clips is found: each media file's sound, analysed. */
function editorSounds(editor: EditorCore) {
  const assets = new Map(editor.media.getAssets().map((asset) => [asset.id, asset]));
  return (mediaId: string): SoundSource | undefined => {
    const asset = assets.get(mediaId);
    if (!asset) return undefined;
    return {
      hasSound: asset.type === "audio" || (asset.type === "video" && asset.hasAudio !== false),
      analyse: () => soundOf(asset.file),
    };
  };
}

async function addAsMusic(sound: MusicSound): Promise<void> {
  const editor = EditorCore.getInstance();
  const project = editor.project.getActive();
  let asset = assetOf(editor, sound);
  if (!asset) {
    const [processed] = await processMediaAssets({ files: [sound.file] });
    if (!processed || processed.type !== "audio")
      throw new Error(`“${sound.name}” could not be read as audio.`);
    asset =
      (await editor.media.addMediaAsset({ projectId: project.metadata.id, asset: processed })) ??
      undefined;
    if (!asset) throw new Error(`“${sound.name}” could not be added.`);
  }
  const audio = await soundOf(sound.file);
  const speech = await speechIn(editor.scenes.getActiveScene().tracks, editorSounds(editor));
  // The timeline as it is once the sound is heard, in case it changed meanwhile.
  const before = editor.scenes.getActiveScene().tracks;
  const after = layMusic(before, {
    mediaId: asset.id,
    name: asset.name,
    duration: asset.duration ?? audio?.duration ?? 0,
    beats: audio?.beats?.times ?? null,
    volume: DEFAULT_MUSIC_DB,
    speech,
  });
  apply(editor, before, after);
}

/** The clips that play a media file on the audio tracks. */
function playing(tracks: SceneTracks, mediaId: string): TimelineElement[] {
  return tracks.audio.flatMap((track) =>
    track.elements.filter(
      (element) => element.sourceType === "upload" && element.mediaId === mediaId,
    ),
  );
}

async function cutToBeat(sound: MusicSound): Promise<void> {
  const editor = EditorCore.getInstance();
  const asset = assetOf(editor, sound);
  if (!asset || !playing(editor.scenes.getActiveScene().tracks, asset.id).length)
    throw new Error(`Add “${sound.name}” to the video first.`);
  const beats = (await soundOf(sound.file))?.beats?.times;
  if (!beats || beats.length < 4) throw new Error(`No steady beat was found in “${sound.name}”.`);
  const before = editor.scenes.getActiveScene().tracks;
  const clips = playing(before, asset.id);
  const ids = new Set(clips.map((clip) => clip.id));
  const after = cutToBeatTimes(
    before,
    clips.flatMap((clip) => beatsOnTimeline(clip, beats)).sort((a, b) => a - b),
    {
      every: 1,
      fps: editor.project.getActive().settings.fps,
      anchored: new Set(
        before.audio
          .filter((track) => track.elements.some((element) => ids.has(element.id)))
          .map((track) => track.id),
      ),
    },
  );
  apply(editor, before, after);
}

const tools: MusicTools = { addAsMusic, cutToBeat };

/** Gives the editor's Sounds tab its music actions while the editor is open. */
export function useEditorMusic() {
  useEffect(() => {
    setMusicTools(tools);
    return () => setMusicTools(null);
  }, []);
}
