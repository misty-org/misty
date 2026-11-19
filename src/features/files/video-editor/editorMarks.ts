import { useEffect } from "react";
import { EditorCore } from "@opencut/core";
import { AddBookmarksCommand } from "@opencut/commands/scene";
import type { MediaAsset } from "@opencut/media/types";
import { hasMediaId, type TimelineElement } from "@opencut/timeline";
import { setFootageMarks, type FootageMarks } from "@opencut/timeline/footage-marks";
import type { MediaTime } from "@opencut/wasm";
import { analyseFootage } from "./analysis/analyse";
import { beatsOnTimeline } from "./tools/beatCuts";
import { allTracks, ticks } from "./tools/projectModel";

/*
 * A clip's "Mark the beat" and "Mark the shots", in the open editor: the footage analysis agents
 * read (video_analysis), shown as bookmarks on the ruler where the clip plays each beat or cut,
 * as one step to undo. Like the rest of the editor's own code, this reads OpenCut's modules, so
 * it loads after OpenCut's core.
 */

/** The most bookmarks one mark puts down, so a long track can't bury the ruler. */
const MAX_MARKS = 500;

/** The clip as the timeline has it now, with the media it plays. */
function clipOf(elementId: string): { element: TimelineElement; asset: MediaAsset } {
  const editor = EditorCore.getInstance();
  const element = allTracks(editor.scenes.getActiveScene().tracks)
    .flatMap((track) => track.elements as TimelineElement[])
    .find((candidate) => candidate.id === elementId);
  if (!element || !hasMediaId(element)) throw new Error("That clip is no longer in the video.");
  const asset = editor.media.getAssets().find((candidate) => candidate.id === element.mediaId);
  if (!asset) throw new Error("That clip's media is no longer in the project.");
  return { element, asset };
}

/** Bookmarks `times` (seconds in the clip's file) where the clip plays them, as one step. */
function mark(elementId: string, times: number[]) {
  // The clip may have moved while its media was analysed: it is read again.
  const { element } = clipOf(elementId);
  const moments = beatsOnTimeline(element, times).slice(0, MAX_MARKS);
  if (!moments.length)
    throw new Error("None of them fall in the part of the clip the video plays.");
  EditorCore.getInstance().command.execute({
    command: new AddBookmarksCommand(moments.map((at) => ticks(at) as MediaTime)),
  });
}

const marks: FootageMarks = {
  async markBeats(elementId) {
    const { asset } = clipOf(elementId);
    const beats = (await analyseFootage(asset.file, { visual: false })).audio?.beats?.times;
    if (!beats || beats.length < 4) throw new Error(`No steady beat was found in “${asset.name}”.`);
    mark(elementId, beats);
  },
  async markShots(elementId) {
    const { asset } = clipOf(elementId);
    const visual = (await analyseFootage(asset.file, { visual: true })).visual;
    if (!visual) throw new Error(`“${asset.name}” couldn't be looked through on this computer.`);
    // Each shot after the first starts at a cut.
    const cuts = visual.scenes.slice(1).map((scene) => scene.start);
    if (!cuts.length) throw new Error(`“${asset.name}” is one shot, with no cuts in it.`);
    mark(elementId, cuts);
  },
};

/** Gives the timeline's clips their beat and shot marks while the editor is open. */
export function useEditorMarks() {
  useEffect(() => {
    setFootageMarks(marks);
    return () => setFootageMarks(null);
  }, []);
}
