export interface UnfinishedItem {
  requirement: string;
  reason: string;
}

const marker = /\n*Still incomplete:\n/;

export function splitUnfinished(text: string): { answer: string; remaining: UnfinishedItem[] } {
  const match = marker.exec(text);
  if (!match) return { answer: text, remaining: [] };
  const remaining = text
    .slice(match.index + match[0].length)
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const split = line.indexOf(": ");
      return split > 0
        ? { requirement: line.slice(0, split), reason: line.slice(split + 2) }
        : { requirement: line, reason: "" };
    });
  return { answer: text.slice(0, match.index).trim(), remaining };
}
