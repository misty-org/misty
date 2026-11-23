import { parseSketch } from "./companion_sketch";

export const replyTags =
  /\[(?:POINT|GUIDE|TASK|FOCUS|OPEN|SETTINGS|DRIVE|REASSIGN|CHAT|REMEMBER|FORGET)[^\]]*\]/g;
const tags = replyTags;
const pointTag = /\[POINT:(?!\s*none\s*\])[^\]]*\]/gi;
const fenced = /```[\s\S]*?(?:```|$)/g;
const sentenceEnd = /[.!?…]+["'”’)\]]*(?=\s)/g;
const SKETCH_FENCE = "```misty-sketch";

function speakable(prose: string) {
  return prose
    .replace(fenced, " ")
    .replace(tags, "")
    .replace(/\[[^\]]*$/, "")
    .replace(/\s+/g, " ");
}

export interface SpokenSoFar {
  text: string;
  marks: { id: string; at: number }[];
  narrated: boolean;
  points: { tag: string; at: number }[];
}

export function spokenParts(answer: string): SpokenSoFar {
  let text = "";
  const points: SpokenSoFar["points"] = [];
  const add = (words: string) => {
    text = (text + words).replace(/\s+/g, " ").replace(/^ /, "");
  };
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

export const spokenText = (reply: string) => spokenParts(reply).text.trim();

export class SpokenSentences {
  private taken = 0;
  private ends: number[] = [];
  readonly items: string[] = [];

  constructor(private readonly onSentence: (sentence: string) => void) {}

  update(text: string) {
    let end = -1;
    sentenceEnd.lastIndex = this.taken;
    for (let match = sentenceEnd.exec(text); match; match = sentenceEnd.exec(text))
      end = match.index + match[0].length;
    if (end > this.taken) this.hand(text.slice(this.taken, end), end);
  }

  finish(text: string) {
    const rest = text.trimEnd();
    if (rest.length > this.taken) this.hand(rest.slice(this.taken), rest.length);
  }

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
