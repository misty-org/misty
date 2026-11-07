import { preferredDefaultSpace } from "@/features/spaces/defaultSpace";
import { useSpacesStore } from "@/features/spaces/spacesStorePublic";
import { spaceWindow } from "@/features/workspace/spaceWindow";

/**
 * The Space of the window this code runs in. Each Space has its own memory
 * tree on the server, so moments are captured, listed and forgotten in the
 * window's Space; unset means the personal Space.
 */
export function windowSpaceId(): string | undefined {
  return spaceWindow().spaceId ?? undefined;
}

/**
 * A Space as Memory on this computer names it. The personal Space is empty on every computer, so a
 * person signed out and the Memory page, which knows its id, read the same tree.
 */
export function memorySpaceKey(spaceId: string | null | undefined): string {
  if (!spaceId) return "";
  return preferredDefaultSpace(useSpacesStore.getState().spaces)?.id === spaceId ? "" : spaceId;
}
