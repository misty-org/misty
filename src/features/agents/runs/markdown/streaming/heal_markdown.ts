// Approach after Vercel's remend (Apache-2.0, Copyright 2023 Vercel, Inc.).
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function closes(line: string, mark: string, fence: string): boolean {
  return mark[0] === fence[0] && mark.length >= fence.length && !line.trim().slice(mark.length);
}

function openFence(text: string): boolean {
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const match = FENCE.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (closes(line, match[1], fence)) fence = null;
  }
  return fence !== null;
}

function count(text: string, mark: string): number {
  let total = 0;
  for (let index = text.indexOf(mark); index >= 0; index = text.indexOf(mark, index + mark.length))
    total += 1;
  return total;
}

export function healMarkdown(text: string): string {
  if (!text || openFence(text)) return text;
  const lastBreak = text.lastIndexOf("\n\n");
  const head = lastBreak >= 0 ? text.slice(0, lastBreak + 2) : "";
  let tail = lastBreak >= 0 ? text.slice(lastBreak + 2) : text;

  tail = tail.replace(/<\/?[A-Za-z][^>\n]*$/, "");
  tail = tail.replace(/!?\[([^\]\n]*)\]\([^)\s]*$/, "$1");
  tail = tail.replace(/!?\[([^\]\n]*)$/, "$1");

  const dangling = /(^|\s)(\*\*|\*|~~|`)$/.exec(tail);
  if (dangling) return healMarkdown(head + tail.slice(0, tail.length - dangling[2].length));

  const ticks = (tail.match(/`/g) ?? []).length;
  if (ticks % 2 === 1) return head + tail + "`";

  const outsideCode = tail.replace(/`[^`]*`/g, "");
  const strong = count(outsideCode, "**") % 2 === 1;
  if (strong && /[^*]\*$/.test(tail)) return head + tail + "*";
  const single = outsideCode
    .replace(/\*\*/g, "")
    .replace(/^\s*\*\s/gm, "")
    .replace(/\s\*\s/g, " ");
  let closers = "";
  if ((single.match(/\*/g) ?? []).length % 2 === 1) closers += "*";
  if (strong) closers += "**";
  if (count(outsideCode, "~~") % 2 === 1) closers += "~~";
  if (count(outsideCode, "$$") % 2 === 1) closers += "$$";
  return head + tail + closers;
}
