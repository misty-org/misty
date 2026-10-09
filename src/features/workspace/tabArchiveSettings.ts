/** Hours a tab may sit unseen before it is archived; 0 turns archiving off. */
let archiveAfterHours = 0;

export function configureTabArchive(hours: number): void {
  archiveAfterHours = Number.isFinite(hours) && hours > 0 ? hours : 0;
}

export function tabArchiveHours(): number {
  return archiveAfterHours;
}
