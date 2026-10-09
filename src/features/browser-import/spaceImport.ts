import { useSpacesStore } from "@/features/spaces/core";
import { openSpaceWindow, spaceWindow } from "@/features/workspace/spaceWindow";
import type { ChosenSource } from "./ImportSourceList";
import type { ImportedExtension } from "./native";
import type { ImportKind } from "./runImport";

/**
 * Importing a browser profile into a Space of its own, the way a Chrome profile
 * maps to one: the new Space's window runs the import, so everything lands in its
 * store. The window that asked hands the import over through storage every app
 * window shares, and the new window takes it as it starts.
 */
export interface SpaceImport {
  spaceId: string;
  source: ChosenSource;
  kinds: ImportKind[];
  extensions: ImportedExtension[];
  at: number;
}

const handOffKey = "misty.browser-import.for-space";
/** A hand-off the new window didn't take by then is stale. */
const handOffFor = 10 * 60 * 1000;

/** Creates a Space named for the profile and opens its window to import into it. */
export async function importIntoNewSpace(
  name: string,
  request: Omit<SpaceImport, "spaceId" | "at">,
): Promise<void> {
  const { space } = await useSpacesStore.getState().createSpace({ name });
  const handOff: SpaceImport = { ...request, spaceId: space.id, at: Date.now() };
  try {
    localStorage.setItem(handOffKey, JSON.stringify(handOff));
  } catch {
    throw new Error("The new Space was made, but the import couldn't be handed to it.");
  }
  await openSpaceWindow(space.id, false);
}

/** The import this window was opened for, once. */
export function takeSpaceImport(): SpaceImport | null {
  const own = spaceWindow();
  if (own.incognito || !own.spaceId) return null;
  try {
    const stored = localStorage.getItem(handOffKey);
    if (!stored) return null;
    const handOff = JSON.parse(stored) as SpaceImport;
    if (handOff.spaceId !== own.spaceId) return null;
    localStorage.removeItem(handOffKey);
    return Date.now() - handOff.at < handOffFor ? handOff : null;
  } catch {
    return null;
  }
}
