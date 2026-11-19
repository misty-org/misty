// Misty: what the Sounds tab's "Add as music" and "Cut to the beat" do. Misty sets them while the
// editor is open (src/features/files/video-editor/editorMusic.ts): they analyse the sound on this
// computer and change the timeline as one step to undo, the same edits agents make
// (add_music, cut_to_beats).
import { useSyncExternalStore } from "react";

export interface MusicSound {
	/** The sound's Media item. */
	id: string;
	name: string;
	file: File;
}

export interface MusicTools {
	/** Lays the sound under the whole video, faded out and ducked under speech. */
	addAsMusic(sound: MusicSound): Promise<void>;
	/** Moves the main track's cuts to the beats of the sound where it plays in the video. */
	cutToBeat(sound: MusicSound): Promise<void>;
}

let current: MusicTools | null = null;
const listeners = new Set<() => void>();

export function setMusicTools(next: MusicTools | null): void {
	current = next;
	for (const listener of listeners) listener();
}

export function useMusicTools(): MusicTools | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current,
		() => current,
	);
}
