// Misty: the rail's Agent tab, a chat with one of the person's agents about the video open in
// the editor. Misty sets what it shows (src/features/files/video-editor); the tab is there only
// while it is set, for a video an agent can work on.
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

let current: ReactNode | null = null;
const listeners = new Set<() => void>();

export function setAgentPanel(next: ReactNode | null): void {
	current = next;
	for (const listener of listeners) listener();
}

export function useAgentPanel(): ReactNode | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current,
		() => current,
	);
}
