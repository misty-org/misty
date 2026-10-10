import { spaceWindow } from "@/features/workspace/spaceWindow";

/**
 * The Space of the window this code runs in. Each Space has its own memory
 * tree on the server, so moments are captured, listed and forgotten in the
 * window's Space; unset means the personal Space.
 */
export function windowSpaceId(): string | undefined {
  return spaceWindow().spaceId ?? undefined;
}
