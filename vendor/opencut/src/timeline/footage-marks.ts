// Misty: what a clip's "Mark the beat" and "Mark the shots" do. Misty sets them while the editor
// is open (src/features/files/video-editor/editorMarks.ts): they analyse the clip's media on this
// computer and put a bookmark on each beat or cut where the clip plays it, as one step to undo.
import { useSyncExternalStore } from "react";
import { toast } from "@opencut/components/toast";

export interface FootageMarks {
	/** Bookmarks each beat of the clip's sound where the clip plays it. */
	markBeats(elementId: string): Promise<void>;
	/** Bookmarks each cut in the clip's picture where the clip plays it. */
	markShots(elementId: string): Promise<void>;
}

let current: FootageMarks | null = null;
const listeners = new Set<() => void>();

export function setFootageMarks(next: FootageMarks | null): void {
	current = next;
	for (const listener of listeners) listener();
}

export function useFootageMarks(): FootageMarks | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current,
		() => current,
	);
}

/** Runs one of the marks, saying in a notice why it couldn't be done. */
export function runFootageMark(work: Promise<void>): void {
	work.catch((reason: unknown) =>
		toast.error(reason instanceof Error ? reason.message : "The clip couldn’t be analysed."),
	);
}
