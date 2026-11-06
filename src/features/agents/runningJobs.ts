/**
 * A running device job learns its run was canceled when it renews its lease. Each one registers its
 * renewal here, so a cancel can ask at once instead of leaving, say, a shell command working until
 * its next heartbeat.
 */
const looks = new Set<() => void>();

/** Registers a running job's lease check. The answer stops watching it. */
export function watchRunningJob(look: () => void): () => void {
  looks.add(look);
  return () => {
    looks.delete(look);
  };
}

export function recheckRunningJobs(): void {
  for (const look of looks) look();
}
