// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
export interface MarkdownChunk {
  text: string;
  start: number;
}

const MARKDOWN_CHUNK_TARGET = 8_000;

const CROSS_CHUNK_SYNTAX = /^ {0,3}\[(?:\\.|[^\]])+\]:|^ {0,3}\[\^(?:\\.|[^\]])+\]:/;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_FENCE = /^ {0,7}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d+[.)])(?:\s|$)/;
const LIST_CONTINUATION = /^(?: {2,}|\t)/;
const QUOTE = /^ {0,3}>/;
const INDENTED = /^(?: {4}|\t)/;
const HTML_OPEN_TAG = /^ {0,3}<([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?>/;
const HTML_VOID_TAGS: Record<string, true> = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true,
};
const INLINE_CODE = /(`+)[^`]*\1/g;
function countDollars(line: string): number {
  const text = line.includes("`") ? line.replace(INLINE_CODE, "") : line;
  let count = 0;
  for (let i = 0; i < text.length - 1; i += 1) {
    if (text[i] === "$" && text[i + 1] === "$") {
      count += 1;
      i += 1;
    }
  }
  return count;
}

export function splitMarkdown(text: string, target = MARKDOWN_CHUNK_TARGET): MarkdownChunk[] {
  if (text.length <= target) {
    return text ? [{ text, start: 0 }] : [];
  }

  const chunks: MarkdownChunk[] = [];
  let chunkStart = 0;
  let lineStart = 0;
  const softMax = target * 2;
  const forceMax = target * 3;
  let fence: { char: string; length: number } | null = null;
  let mathOpen = false;
  let htmlCloseRe: RegExp | null = null;
  let inList = false;
  let inQuote = false;
  let inIndented = false;
  let blankEnd: number | null = null;
  const commit = (end: number) => {
    if (end - chunkStart < target) return;
    chunks.push({ text: text.slice(chunkStart, end), start: chunkStart });
    chunkStart = end;
  };

  while (lineStart < text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    const trimmed = line.trimStart();

    if (!trimmed) {
      if (!fence && !mathOpen && !htmlCloseRe && lineEnd >= chunkStart) {
        blankEnd = Math.min(lineEnd + 1, text.length);
      }
      lineStart = lineEnd + 1;
      continue;
    }

    if (htmlCloseRe) {
      if (htmlCloseRe.test(line)) {
        htmlCloseRe = null;
      }
      blankEnd = null;
      lineStart = lineEnd + 1;
      continue;
    }

    if (fence) {
      const close = (inList ? LIST_FENCE : FENCE).exec(line);
      if (
        close &&
        close[1][0] === fence.char &&
        close[1].length >= fence.length &&
        line.slice(close[0].length).trim() === ""
      ) {
        fence = null;
      }
      blankEnd = null;
      lineStart = lineEnd + 1;
      continue;
    }

    if (blankEnd !== null) {
      const overHardCap =
        (blankEnd - chunkStart >= softMax && !/^\s/.test(line)) || lineEnd - chunkStart > forceMax;
      const continuesIndented = !overHardCap && inIndented && INDENTED.test(line);
      const continuesList =
        !overHardCap && inList && (LIST_ITEM.test(line) || LIST_CONTINUATION.test(line));
      const continuesQuote = !overHardCap && inQuote && QUOTE.test(line);
      if (!continuesIndented && !continuesList && !continuesQuote) {
        commit(blankEnd);
        inList = false;
        inQuote = false;
        inIndented = false;
      }
      blankEnd = null;
    }

    const open = (inList ? LIST_FENCE : FENCE).exec(line);
    if (open && !(open[1][0] === "`" && line.slice(open[0].length).includes("`"))) {
      fence = { char: open[1][0], length: open[1].length };
      lineStart = lineEnd + 1;
      continue;
    }
    const dollars = countDollars(line);
    if (mathOpen || dollars % 2 === 1) {
      mathOpen = mathOpen ? dollars % 2 === 0 : dollars % 2 === 1;
      blankEnd = null;
      lineStart = lineEnd + 1;
      continue;
    }

    if (CROSS_CHUNK_SYNTAX.test(line)) {
      return [{ text, start: 0 }];
    }
    if (line.startsWith("<!--") || trimmed.startsWith("<!--")) {
      if (!line.includes("-->")) {
        htmlCloseRe = /-->/;
        blankEnd = null;
        lineStart = lineEnd + 1;
        continue;
      }
    } else {
      const htmlMatch = HTML_OPEN_TAG.exec(line);
      if (htmlMatch) {
        const tag = htmlMatch[1].toLowerCase();
        const selfClosing = /\/>\s*$/.test(line) || Boolean(HTML_VOID_TAGS[tag]);
        const closeRe = new RegExp(`</${tag}\\s*>`, "i");
        if (!selfClosing && !closeRe.test(line)) {
          htmlCloseRe = closeRe;
          blankEnd = null;
          lineStart = lineEnd + 1;
          continue;
        }
      }
    }
    inList = inList || LIST_ITEM.test(line);
    inQuote = QUOTE.test(line);
    inIndented = !inList && INDENTED.test(line);
    lineStart = lineEnd + 1;
  }

  if (chunkStart < text.length) {
    chunks.push({ text: text.slice(chunkStart), start: chunkStart });
  }
  return chunks;
}
