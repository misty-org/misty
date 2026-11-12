import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useTutorStore } from "./tutorStore";
import type { Guide, VideoScene } from "./tutorTypes";

/**
 * A video overview's footage: each scene filmed as a silent clip on this computer's video model and
 * key (Settings → Models), kept as MP4 in Misty's folder. The engine writes the shot; the video
 * model films it. Without a video model the scenes keep the engine's drawings.
 */

/** The clip file of one scene. */
export const sceneClipId = (guideId: string, index: number) => `${guideId}-c${index}`;

/** Native code's answer when the device has no video model (`tutor_video.rs`). */
const noVideoModel = /^Choose a video model/;

/** What the video model is asked to film for a scene. */
export function shotPrompt(scene: VideoScene): string {
  const shot = scene.shot || `${scene.heading}. ${scene.narration}`;
  return `${shot}\n\nSilent explainer footage. No words, letters, numbers or captions on screen.`;
}

/** How long a scene's clip runs: its narration's length, within what the model makes. */
export function clipSeconds(scene: VideoScene): number {
  return Math.min(15, Math.max(4, Math.round(scene.seconds ?? 8)));
}

/** Films every scene that has no clip yet, one at a time, stopping at the first failure. */
export async function makeVideoClips(guideId: string): Promise<void> {
  const store = useTutorStore.getState();
  const video = store.guides[guideId];
  if (!video?.scenes?.length || video.clips?.state === "making") return;
  const save = (change: Partial<Guide>) => {
    const current = useTutorStore.getState().guides[guideId];
    if (current) store.saveGuide({ ...current, ...change, updatedAt: new Date().toISOString() });
  };
  if (!hasTauriInternals())
    return save({ clips: { state: "failed", error: "Videos are filmed in the Misty app." } });
  save({ clips: { state: "making" } });
  for (const [index, scene] of video.scenes.entries()) {
    if (scene.clip) continue;
    try {
      await invoke<void>("tutor_video_clip_make", {
        id: sceneClipId(guideId, index),
        prompt: shotPrompt(scene),
        seconds: clipSeconds(scene),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return save({
        clips: { state: noVideoModel.test(message) ? "off" : "failed", error: message },
      });
    }
    // The latest scenes: narration may have given them their lengths meanwhile.
    const scenes = [...(useTutorStore.getState().guides[guideId]?.scenes ?? video.scenes)];
    scenes[index] = { ...scenes[index], clip: true };
    save({ scenes, clips: { state: "making" } });
  }
  save({ clips: { state: "ready" } });
}

/** A playable address for a scene's clip; revoke it when done. */
export async function sceneClipUrl(guideId: string, index: number): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("tutor_video_clip", { id: sceneClipId(guideId, index) });
  return URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
}

export async function deleteVideoClips(guide: Guide): Promise<void> {
  if (!hasTauriInternals()) return;
  await Promise.all(
    (guide.scenes ?? []).map((scene, index) =>
      scene.clip
        ? invoke<void>("tutor_video_clip_delete", { id: sceneClipId(guide.id, index) }).catch(
            () => undefined,
          )
        : undefined,
    ),
  );
}
