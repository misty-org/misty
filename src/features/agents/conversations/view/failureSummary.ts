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

/** What a reply that never started says: it can be tried again, and what to do if that fails. */
export const answerNotStarted =
  "This answer didn't start. Try again, and if it fails again, quit Misty and open it again.";

/** Replies saved before said only that Misty could not start the answer; they read the same now. */
export function currentFailureWords(text: string): string {
  return /could not start this answer/i.test(text) ? answerNotStarted : text;
}
