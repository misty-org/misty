// Misty: the last error each motion graphic's script hit while being drawn, by script, so the
// properties panel can show it beside the code. A frame that draws clears it.
import { useSyncExternalStore } from "react";

const errors = new Map<string, string>();
const listeners = new Set<() => void>();

export function reportMotionError({
	script,
	error,
}: {
	script: string;
	error: string | null;
}): void {
	const previous = errors.get(script) ?? null;
	if (previous === error) return;
	if (error === null) {
		errors.delete(script);
	} else {
		errors.set(script, error);
	}
	for (const listener of listeners) listener();
}

export function getMotionError({ script }: { script: string }): string | null {
	return errors.get(script) ?? null;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useMotionError({ script }: { script: string }): string | null {
	return useSyncExternalStore(
		subscribe,
		() => getMotionError({ script }),
		() => null,
	);
}
