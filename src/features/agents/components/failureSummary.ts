/**
 * A failed run's text is its closing answer followed, when a tool call stopped it, by one line
 * naming what failed ("I couldn't fully complete that request. screen close: The tool could not
 * complete this action."). The answer reads as the answer; only that short reason goes in the
 * failure row, since nobody reads a whole answer inside a failure card.
 */
const marker = "I couldn't fully complete that request.";
const longest = 200;

export function splitFailure(text: string): { answer: string; reason: string } {
  const trimmed = text.trim();
  const at = trimmed.lastIndexOf(marker);
  if (at < 0) return { answer: trimmed, reason: "" };
  const reason = trimmed
    .slice(at + marker.length)
    .replace(/\s+/g, " ")
    .trim();
  return {
    answer: trimmed.slice(0, at).trim(),
    reason: reason.length > longest ? `${reason.slice(0, longest - 1).trimEnd()}…` : reason,
  };
}
