/**
 * What the ⌘T panel thinks typed text means, decided by local rules with no
 * model call: an address opens, a question or request asks an agent, and
 * anything else searches the web. Jumping to a place comes from the matches
 * themselves; a strong name match outranks the guess.
 */
export type InputIntent = "url" | "ask" | "search";

const QUESTION_WORDS = new Set(
  (
    "what why how when where who whom whose which can could should would will is are was were do " +
    "does did am may might shall"
  ).split(" "),
);

const REQUEST_VERBS = new Set(
  (
    "write rewrite draft summarize summarise explain help plan make create build design fix find " +
    "compare translate review organize organise schedule book email send remind list outline show " +
    "tell give generate analyze analyse research brainstorm suggest recommend prepare edit update " +
    "check convert calculate figure"
  ).split(" "),
);

const ADDRESS =
  /^(?:[a-z][a-z0-9+.-]*:\/\/|about:|localhost(?::\d+)?(?:[/?#]|$)|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$))/i;
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i;

export function inputIntent(raw: string): InputIntent {
  const text = raw.trim();
  if (!text) return "search";
  if (!/\s/.test(text) && (ADDRESS.test(text) || DOMAIN.test(text))) return "url";
  const words = text.toLowerCase().split(/\s+/);
  const first = words[0].replace(/[^a-z']/g, "");
  if (text.endsWith("?") && words.length >= 2) return "ask";
  if (words.length >= 3 && QUESTION_WORDS.has(first)) return "ask";
  if (words.length >= 2 && REQUEST_VERBS.has(first)) return "ask";
  if (words.length >= 3 && (first === "i" || first === "i'm" || first === "im" || first === "my"))
    return "ask";
  if (words.length >= 3 && words[0] === "please") return "ask";
  return "search";
}
