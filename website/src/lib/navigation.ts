/**
 * Only same-site absolute paths are ever used as a post-auth destination.
 * Anything else — an absolute URL, a scheme-relative "//host" — would turn a
 * redirect target into an off-site hop.
 */
export function safeInternalPath(path: unknown): string | null {
  // Deliberately `unknown` rather than `string | undefined`: a zero-arg handler
  // like `onClick={logout}` will hand us a DOM event, and TypeScript allows
  // that because a function with an optional parameter is assignable to
  // `() => void`. Rejecting non-strings here keeps that from throwing.
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}
