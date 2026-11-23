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

export const answerNotStarted =
  "This answer didn't start. Try again, and if it fails again, quit Misty and open it again.";

export function currentFailureWords(text: string): string {
  return /could not start this answer/i.test(text) ? answerNotStarted : text;
}
