/**
 * Splits composer text into plain and `@Name` segments, matched against the
 * Space's actual roster so only real mentions light up (not just any `@`).
 */
export interface MentionSegment {
  text: string;
  mention: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMentionPattern(names: string[]): RegExp | undefined {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (unique.length === 0) return undefined;
  return new RegExp(`@(?:${unique.map(escapeRegExp).join("|")})(?=\\s|$)`, "g");
}

export function splitMentionSegments(text: string, names: string[]): MentionSegment[] {
  const pattern = buildMentionPattern(names);
  if (!pattern || !text) return [{ text, mention: false }];

  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), mention: false });
    segments.push({ text: match[0], mention: true });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), mention: false });
  return segments;
}
