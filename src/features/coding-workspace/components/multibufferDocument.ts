import type { CodeMultibufferSpec } from "@/features/workspace";
import type { SearchMatch } from "../native";
import type { OpenTab } from "../store/useCodingWorkspaceStore";

export interface Excerpt {
  id: string;
  path: string;
  relative: string;
  startLine: number;
  endLine: number;
  sourceFrom: number;
  sourceTo: number;
  virtualFrom: number;
  virtualTo: number;
  headerFrom: number;
}

export interface MultibufferDocument {
  text: string;
  excerpts: Excerpt[];
}

export function buildMultibufferDocument(
  rootPath: string,
  _spec: CodeMultibufferSpec,
  matches: SearchMatch[],
  buffers: Record<string, OpenTab>,
  contentOverrides: Map<string, string>,
): MultibufferDocument {
  const intervals = mergedIntervals(matches);
  let text = "";
  const excerpts: Excerpt[] = [];
  for (const interval of intervals) {
    const buffer = buffers[interval.path];
    if (!buffer || buffer.loading || buffer.error) continue;
    const contents = contentOverrides.get(interval.path) ?? buffer.contents;
    const lines = lineOffsets(contents);
    const startLine = Math.max(1, interval.startLine);
    const endLine = Math.min(lines.length, interval.endLine);
    const sourceFrom = lines[startLine - 1]?.from ?? 0;
    const sourceTo = lines[endLine - 1]?.toWithBreak ?? contents.length;
    const relative = interval.relative || interval.path.slice(rootPath.length).replace(/^\//, "");
    const header = `${text ? "\n" : ""}── ${relative}:${startLine}-${endLine} ──\n`;
    const headerFrom = text.length + (text ? 1 : 0);
    text += header;
    const virtualFrom = text.length;
    text += contents.slice(sourceFrom, sourceTo);
    const virtualTo = text.length;
    excerpts.push({
      id: `${interval.path}:${startLine}:${endLine}`,
      path: interval.path,
      relative,
      startLine,
      endLine,
      sourceFrom,
      sourceTo,
      virtualFrom,
      virtualTo,
      headerFrom,
    });
  }
  return { text, excerpts };
}

function mergedIntervals(matches: SearchMatch[]) {
  const byPath = new Map<string, Array<{ startLine: number; endLine: number; relative: string }>>();
  for (const match of matches) {
    const list = byPath.get(match.path) ?? [];
    list.push({
      startLine: Math.max(1, match.lineNumber - 2),
      endLine: match.lineNumber + 2,
      relative: match.relative,
    });
    byPath.set(match.path, list);
  }
  return [...byPath.entries()].flatMap(([path, values]) => {
    const sorted = [...values].sort((a, b) => a.startLine - b.startLine);
    const merged: typeof sorted = [];
    for (const value of sorted) {
      const previous = merged[merged.length - 1];
      if (previous && value.startLine <= previous.endLine + 1)
        previous.endLine = Math.max(previous.endLine, value.endLine);
      else merged.push({ ...value });
    }
    return merged.map((interval) => ({ path, ...interval }));
  });
}

function lineOffsets(contents: string) {
  const lines: Array<{ from: number; toWithBreak: number }> = [];
  let from = 0;
  for (const part of contents.split(/(?<=\n)/)) {
    lines.push({ from, toWithBreak: from + part.length });
    from += part.length;
  }
  return lines.length ? lines : [{ from: 0, toWithBreak: 0 }];
}
