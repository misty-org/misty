import { parseSketch } from "./companionSketch";

/** The tags the engine puts in an answer, which are acted on and never read aloud. */
export const replyTags = /\[(?:POINT|GUIDE|TASK|FOCUS|OPEN|SETTINGS|DRIVE)[^\]]*\]/g;
const tags = replyTags;
/** A point at something on screen, where it sits among the words. */
const pointTag = /\[POINT:(?!\s*none\s*\])[^\]]*\]/gi;
/** A fenced block, finished or still being written, which is never read as it's written. */
const fenced = /```[\s\S]*?(?:```|$)/g;
/** The end of a sentence, once what follows shows it really ended ("3.5" and "e.g" don't). */
const sentenceEnd = /[.!?…]+["'”’)\]]*(?=\s)/g;
const SKETCH_FENCE = "```misty-sketch";

/** Words to read: no tags, no blocks, one space between words. */
function speakable(prose: string) {
  return prose
    .replace(fenced, " ")
    .replace(tags, "")
    .replace(/\[[^\]]*$/, "")
    .replace(/\s+/g, " ");
}

/** What an answer says aloud so far, and where in it each drawn element comes in. */
export interface SpokenSoFar {
  /** The answer's own sentences, with its drawing's narration (each element's "say") in place. */
  text: string;
  /** Each drawn element, with the place in `text` whose sentence brings it in. */
  marks: { id: string; at: number }[];
  /** Whether the drawing is narrated at all; one that isn't is shown as it's drawn. */
  narrated: boolean;
  /** Each [POINT] tag, with the place in `text` of the sentence it follows. */
  points: { tag: string; at: number }[];
}

/**
 * An answer, finished or still being written, as it's read aloud: its sentences in order, with
 * the drawing's narration where the drawing is, so each element can appear as its sentence is
 * said. An element without a say comes in with the narrated one before it.
 */
export function spokenParts(answer: string): SpokenSoFar {
  let text = "";
  const points: SpokenSoFar["points"] = [];
  const add = (words: string) => {
    text = (text + words).replace(/\s+/g, " ").replace(/^ /, "");
  };
  // Words, with each point noted at the sentence just before it.
  const addProse = (prose: string) => {
    let from = 0;
    for (const match of prose.matchAll(pointTag)) {
      add(speakable(prose.slice(from, match.index!)));
      points.push({ tag: match[0], at: Math.max(0, text.trimEnd().length - 1) });
      from = match.index! + match[0].length;
    }
    add(speakable(prose.slice(from)));
  };
  const start = answer.indexOf(SKETCH_FENCE);
  if (start < 0) {
    addProse(answer);
    return { text, marks: [], narrated: false, points };
  }
  addProse(answer.slice(0, start));
  const sketch = parseSketch(answer);
  const marks: SpokenSoFar["marks"] = [];
  let said: number | undefined;
  for (const element of sketch?.elements ?? []) {
    if (!element.say) {
      marks.push({ id: element.id, at: said ?? text.length });
      continue;
    }
    if (text && !text.endsWith(" ")) add(" ");
    said = text.length;
    marks.push({ id: element.id, at: said });
    add(/[.!?…]["'”’)\]]*$/.test(element.say) ? `${element.say} ` : `${element.say}. `);
  }
  if (sketch?.done) {
    const close = answer.indexOf("```", answer.indexOf("\n", start) + 1);
    add(" ");
    addProse(answer.slice(close + 3));
  }
  return { text, marks, narrated: said !== undefined, points };
}

/** The words of a finished answer to say aloud, drawing narration included. */
export const spokenText = (reply: string) => spokenParts(reply).text.trim();

/**
 * Hands an answer's sentences on as the answer is written, each once, so reading it aloud starts
 * with the first sentence instead of waiting for the whole answer. Each handing is one item of
 * the reading, which may hold more than one sentence when they arrive together.
 */
export class SpokenSentences {
  /** How much of the spoken text has been handed on. */
  private taken = 0;
  /** Where each handed item ends in the spoken text. */
  private ends: number[] = [];
  /** Each handed item's words, for captions. */
  readonly items: string[] = [];

  constructor(private readonly onSentence: (sentence: string) => void) {}

  /** The spoken text so far (`spokenParts`): every sentence that has ended since is handed on. */
  update(text: string) {
    let end = -1;
    sentenceEnd.lastIndex = this.taken;
    for (let match = sentenceEnd.exec(text); match; match = sentenceEnd.exec(text))
      end = match.index + match[0].length;
    if (end > this.taken) this.hand(text.slice(this.taken, end), end);
  }

  /** The finished answer's spoken text: whatever hasn't been handed on yet goes now. */
  finish(text: string) {
    const rest = text.trimEnd();
    if (rest.length > this.taken) this.hand(rest.slice(this.taken), rest.length);
  }

  /** Which handed item holds the place `at` in the spoken text; undefined until it's handed. */
  itemAt(at: number) {
    const index = this.ends.findIndex((end) => at < end);
    return index < 0 ? undefined : index;
  }

  private hand(sentence: string, end: number) {
    this.taken = end;
    if (!sentence.trim()) return;
    this.ends.push(end);
    this.items.push(sentence.trim());
    this.onSentence(sentence.trim());
  }
}

/**
 * The drawn elements to show once the voice has begun `started` items: each element shows from
 * the start of the sentence that brings it in. Undefined shows every element, for a drawing
 * that isn't narrated.
 */
export function shownElements(
  parts: SpokenSoFar,
  sentences: SpokenSentences,
  started: number,
): ReadonlySet<string> | undefined {
  if (!parts.narrated) return undefined;
  const shown = new Set<string>();
  for (const mark of parts.marks) {
    const item = sentences.itemAt(mark.at);
    if (item !== undefined && item < started) shown.add(mark.id);
  }
  return shown;
}
