import { createPort } from "@/shared/lib/seams";
import { spaceWindow } from "../tabs/spaceWindow";

/** What features below Spaces need to know about a Space: which one it is and how it is shared. */
export interface SpaceSummary {
  id: string;
  name: string;
  is_default?: boolean;
  role?: string;
}

/** The account's protected default Space is the home fallback. */
export function preferredDefaultSpace<T extends SpaceSummary>(spaces: T[]): T | undefined {
  return (
    spaces.find((space) => space.is_default && space.role === "owner") ??
    spaces.find((space) => space.is_default) ??
    spaces[0]
  );
}

/**
 * The Space this window shows now. The personal Space's id comes from the account's Spaces.
 */
export function windowSpace<T extends SpaceSummary>(spaces: T[]): T | undefined {
  const own = spaceWindow();
  return own.personal
    ? preferredDefaultSpace(spaces)
    : spaces.find((space) => space.id === own.spaceId);
}

interface SpacesView {
  spaces: SpaceSummary[];
  load: (options?: { force?: boolean; accountId?: string }) => Promise<void>;
}

/** The Spaces store as lower features see it; Spaces fills it in once at startup. */
interface SpacesDirectory {
  <T>(selector: (state: SpacesView) => T): T;
  getState(): SpacesView;
}

export const spacesDirectory = createPort<SpacesDirectory>("the list of Spaces");

export function useSpacesDirectory<T>(selector: (state: SpacesView) => T): T {
  return spacesDirectory.get()(selector);
}

export function spacesSnapshot(): SpacesView {
  return spacesDirectory.get().getState();
}
