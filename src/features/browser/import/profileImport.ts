import { createProfile, currentProfile, isIncognitoWindow } from "@/features/app-windows";
import type { ChosenSource } from "./ImportSourceList";
import type { ImportedExtension } from "./native";
import type { ImportKind } from "./runImport";

/**
 * Importing another browser's profile into a Misty profile of its own: the new profile's first
 * window runs the import, so everything lands in its store. The window that asked hands the
 * import over through storage every app window shares, and the new window takes it as it starts.
 */
export interface ProfileImport {
  /** Who it is for: by id once the profile exists, by name until the native side answers. */
  profileId?: string;
  profileName: string;
  source: ChosenSource;
  kinds: ImportKind[];
  extensions: ImportedExtension[];
  at: number;
}

const handOffKey = "misty.browser-import.for-profile";
/** A hand-off the new window didn't take by then is stale. */
const handOffFor = 10 * 60 * 1000;

function store(handOff: ProfileImport) {
  try {
    localStorage.setItem(handOffKey, JSON.stringify(handOff));
  } catch {
    throw new Error("The import couldn't be handed to the new profile.");
  }
}

/** Adds a profile named for the source and opens its window to import into it. */
export async function importIntoNewProfile(
  name: string,
  request: Pick<ProfileImport, "source" | "kinds" | "extensions">,
): Promise<void> {
  const handOff: ProfileImport = { ...request, profileName: name, at: Date.now() };
  // Written first: the new window may start before this call returns.
  store(handOff);
  const profile = await createProfile(name);
  if (localStorage.getItem(handOffKey)) store({ ...handOff, profileId: profile.id });
}

/** The import this window was opened for, once. */
export function takeProfileImport(): ProfileImport | null {
  if (isIncognitoWindow()) return null;
  const own = currentProfile();
  try {
    const stored = localStorage.getItem(handOffKey);
    if (!stored) return null;
    const handOff = JSON.parse(stored) as ProfileImport;
    const forHere = handOff.profileId
      ? handOff.profileId === own.id
      : handOff.profileName === own.name;
    if (!forHere) return null;
    localStorage.removeItem(handOffKey);
    return Date.now() - handOff.at < handOffFor ? handOff : null;
  } catch {
    return null;
  }
}
