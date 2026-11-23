let loadedFrom = 0;
let reloadQueued: () => boolean = () => false;

export function setSpacesSnapshotQueuedCheck(check: () => boolean): void {
  reloadQueued = check;
}

export function spacesSnapshotReloadQueued(): boolean {
  return reloadQueued();
}

export function noteSpacesSnapshotLoaded(requestedAt: number): void {
  loadedFrom = Math.max(loadedFrom, requestedAt);
}

export function spacesSnapshotLoadedSince(time: number): boolean {
  return loadedFrom >= time;
}

export function spacesSnapshotLoadedAt(): number {
  return loadedFrom;
}

export function resetSpacesSnapshotFreshness(): void {
  loadedFrom = 0;
}
