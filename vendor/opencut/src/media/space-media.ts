// Misty: the Space the editor was opened from, as the editor's Media and Sounds tabs see it.
// Misty sets it while the editor is open (src/features/files/video-editor); OpenCut's own
// import from the computer keeps working beside it.
import { useSyncExternalStore } from "react";

export interface SpaceMediaFile {
	id: string;
	name: string;
}

export interface SpaceMedia {
	/**
	 * Opens the Space's Media picker; resolves with the files chosen, none when cancelled.
	 * `single` lets one file be chosen.
	 */
	pick(options?: { single?: boolean }): Promise<File[]>;
	/** The Space's audio files, newest first. */
	listAudio(): Promise<SpaceMediaFile[]>;
	/** Reads one of the Space's files. */
	load(id: string): Promise<File>;
}

let current: SpaceMedia | null = null;

/** The Media item each file read from the Space is, so keeping a project doesn't upload it again. */
const itemsOfFiles = new WeakMap<File, string>();

export function rememberSpaceItem(file: File, itemId: string): void {
	itemsOfFiles.set(file, itemId);
}

/** The Space's Media item a file was read from, if it was. */
export function spaceItemOf(file: File): string | undefined {
	return itemsOfFiles.get(file);
}

const listeners = new Set<() => void>();

export function setSpaceMedia(next: SpaceMedia | null): void {
	current = next;
	for (const listener of listeners) listener();
}

export function getSpaceMedia(): SpaceMedia | null {
	return current;
}

export function useSpaceMedia(): SpaceMedia | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current,
		() => current,
	);
}
