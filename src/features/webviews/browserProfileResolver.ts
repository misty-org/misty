/** The website-data identity of a view's device profile; registered at startup. */
let resolver: ((viewId: string) => string | undefined) | null = null;

export function setBrowserProfileResolver(
  next: ((viewId: string) => string | undefined) | null,
): void {
  resolver = next;
}

/** The profile a view's page opens in: its own, else its device profile's. */
export function browserProfileFor(viewId: string, own?: string): string | undefined {
  return own ?? resolver?.(viewId);
}
