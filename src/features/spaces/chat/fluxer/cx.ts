/** Joins CSS-module class names, skipping falsy ones (Fluxer's `clsx`). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
