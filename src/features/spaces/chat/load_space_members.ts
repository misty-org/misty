import { useSpacesStore } from "../list/use_spaces_store";

const pending = new Map<string, Promise<void>>();

export function loadSpaceMembers(spaceId: string): Promise<void> {
  const running = pending.get(spaceId);
  if (running) return running;
  const load = Promise.resolve(useSpacesStore.getState().loadMembers(spaceId)).finally(() =>
    pending.delete(spaceId),
  );
  pending.set(spaceId, load);
  return load;
}
