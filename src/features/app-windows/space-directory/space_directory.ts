import { createPort } from "@/shared/lib/seams";
import { spaceWindow } from "../tabs/space_window";

export interface SpaceSummary {
  id: string;
  name: string;
  is_default?: boolean;
  role?: string;
}

export function preferredDefaultSpace<T extends SpaceSummary>(spaces: T[]): T | undefined {
  return (
    spaces.find((space) => space.is_default && space.role === "owner") ??
    spaces.find((space) => space.is_default) ??
    spaces[0]
  );
}

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
