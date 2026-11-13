// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { IBufferRange, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { filesApi } from "../files/filesApi";

/**
 * Links in terminal output: absolute paths inside the terminal's folder, and web addresses.
 * Build tools print artifact paths one per line ("Finished 2 bundles at: …"), and turning those
 * into modifier-clicks that open the file is the point. A shell prints arbitrary prose, so only
 * absolute POSIX or Windows-drive paths are considered.
 *
 * Spaces are allowed inside a path candidate ("My Project/…"), so the pattern over-captures
 * trailing prose on purpose; the existence probe then trims word by word from the right until
 * what remains is real. Only paths under the terminal's folder are probed and linked: the
 * native side refuses anything outside the folders linked to the Space anyway.
 */

// One absolute-path candidate: drive or root prefix, a run without spaces, then any number of
// space-separated continuations (over-captured on purpose, see above). Characters that never
// appear unquoted in printed paths end it.
const PATH_CANDIDATE = /(?:[A-Za-z]:[\\/](?![\\/])|\/)[^\s`"'<>|]+(?: [^\s`"'<>|]+)*/g;

// Sentence punctuation a printed path picks up at the end of a line. `.` stays: real extensions
// end in one, and a trailing dot fails the probe anyway.
const TRAILING_NOISE = /[,;:!?)\]}"']+$/;

const URL_CANDIDATE = /\bhttps?:\/\/[^\s`"'<>|]+/g;
const URL_TRAILING_NOISE = /[,;:!?.)\]}"']+$/;

const MAX_LINKS_PER_LINE = 16;
const MAX_PROBE_STEPS = 8;
const MAX_LOGICAL_ROWS = 10;
const MAX_CACHE_ENTRIES = 500;

interface LogicalRow {
  /** 1-based buffer row. */
  y: number;
  /** Offset of this row's first character in the joined logical line. */
  start: number;
  /** Row length in string units, blank padding included. */
  length: number;
}

interface LogicalLine {
  text: string;
  rows: LogicalRow[];
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Whether `path` is `folder` itself or lies inside it. */
export function isPathUnder(path: string, folder: string): boolean {
  const target = normalize(path);
  const base = normalize(folder);
  if (!base) return false;
  const windows = /^[a-z]:\//i.test(base);
  const [t, b] = windows ? [target.toLowerCase(), base.toLowerCase()] : [target, base];
  return t === b || t.startsWith(`${b}/`);
}

function parentAndName(path: string): [string, string] | null {
  const clean = path.replace(/[\\/]+$/, "");
  const cut = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (cut <= 0) return null;
  return [clean.slice(0, cut), clean.slice(cut + 1)];
}

/** What a printed path is on disk, from a listing of its parent; null when it isn't there. */
export async function probePath(path: string): Promise<{ isDir: boolean } | null> {
  const split = parentAndName(path);
  if (!split) return null;
  const [parent, name] = split;
  try {
    const entries = await filesApi.listDir(parent);
    const found = entries.find((entry) => entry.name === name);
    return found ? { isDir: found.isDir } : null;
  } catch {
    return null;
  }
}

export interface ResolvedPath {
  path: string;
  isDir: boolean;
}

// The probe lists a parent folder per candidate, so results are kept: xterm asks for links on
// every hover, and after the first one that costs nothing. Keyed by folder and candidate, so tabs
// in different folders never share a verdict.
const probeCache = new Map<string, Promise<ResolvedPath | null>>();

async function probe(raw: string, cwd: string): Promise<ResolvedPath | null> {
  let candidate = raw.replace(TRAILING_NOISE, "");
  if (!candidate || !isPathUnder(candidate, cwd)) return null;
  for (let step = 0; step < MAX_PROBE_STEPS && candidate; step += 1) {
    const found = await probePath(candidate);
    if (found) return { path: candidate, isDir: found.isDir };
    const cut = candidate.lastIndexOf(" ");
    if (cut < 0) break;
    candidate = candidate.slice(0, cut).replace(TRAILING_NOISE, "");
  }
  return null;
}

function resolveCandidate(raw: string, cwd: string): Promise<ResolvedPath | null> {
  const key = `${cwd}\n${raw}`;
  let cached = probeCache.get(key);
  if (!cached) {
    if (probeCache.size >= MAX_CACHE_ENTRIES) probeCache.clear();
    cached = probe(raw, cwd);
    probeCache.set(key, cached);
  }
  return cached;
}

/** Forgets every probe verdict, as files change under a terminal. */
export function clearLinkCache(): void {
  probeCache.clear();
}

/**
 * Soft-wrapped buffer rows joined into one logical line. Long paths wrap at narrow panel widths,
 * and matching row by row would see a cut-off path that fails the probe and never links. Blank
 * padding is kept (`translateToString(false)`) so string offsets stay aligned with cell columns.
 */
function logicalLineAt(term: Terminal, y: number): LogicalLine | null {
  const buffer = term.buffer.active;
  let first = y - 1;
  let line = buffer.getLine(first);
  if (!line) return null;
  while (line.isWrapped && first > 0) {
    first -= 1;
    const previous = buffer.getLine(first);
    if (!previous) break;
    line = previous;
  }
  const rows: LogicalRow[] = [];
  let text = "";
  let rowIndex = first;
  while (rows.length < MAX_LOGICAL_ROWS) {
    const row = buffer.getLine(rowIndex);
    if (!row) break;
    const rowText = row.translateToString(false);
    rows.push({ y: rowIndex + 1, start: text.length, length: rowText.length });
    text += rowText;
    const next = buffer.getLine(rowIndex + 1);
    if (!next?.isWrapped) break;
    rowIndex += 1;
  }
  return { text: text.trimEnd(), rows };
}

// xterm places links in cells; translateToString gives string indices. Wide characters (CJK)
// take two cells, so a plain index would shift the span left of the real text. These are the
// wide ranges xterm itself uses, without zero-width marks, which are rare in printed paths.
function cellWidth(text: string): number {
  let cells = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    cells +=
      (cp >= 0x1100 && cp <= 0x115f) ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
        ? 2
        : 1;
  }
  return cells;
}

function locate(log: LogicalLine, index: number): { x: number; y: number } {
  let row = log.rows[0];
  for (const candidate of log.rows) {
    if (index < candidate.start + candidate.length) {
      row = candidate;
      break;
    }
    row = candidate;
  }
  return { x: cellWidth(log.text.slice(row.start, index)) + 1, y: row.y };
}

function rangeOf(log: LogicalLine, start: number, length: number): IBufferRange {
  // The range's end is the last cell, inclusive: locating the last character itself keeps a
  // link that ends at a wrapped row's edge on its own row.
  return { start: locate(log, start), end: locate(log, start + length - 1) };
}

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * Opening a link is a modifier gesture: a plain click lands on printed output far too easily
 * (selecting text, clicking back into the window) to let it open a file. macOS uses ⌘ or ⌥ (the
 * terminal already treats ⌥ as meta), Windows and Linux use Ctrl, like Windows Terminal and
 * GNOME Terminal. Without the modifier a link still underlines on hover.
 */
export function holdsLinkModifier(
  event: Pick<MouseEvent, "altKey" | "ctrlKey" | "metaKey">,
  mac: boolean = isMacPlatform(),
): boolean {
  return mac ? event.altKey || event.metaKey : event.ctrlKey;
}

/**
 * Every visible row is scanned for absolute-path candidates; each resolves (async, cached) to its
 * longest real prefix and becomes a link covering just that prefix.
 */
export function createPathLinkProvider(options: {
  term: Terminal;
  cwd: string;
  onActivate: (target: ResolvedPath) => void;
}): ILinkProvider {
  const { term, cwd, onActivate } = options;
  return {
    provideLinks(y, callback) {
      const log = logicalLineAt(term, y);
      if (!log || !/[\\/]/.test(log.text)) {
        callback(undefined);
        return;
      }
      const matches: { start: number; raw: string }[] = [];
      PATH_CANDIDATE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PATH_CANDIDATE.exec(log.text)) !== null) {
        if (matches.length >= MAX_LINKS_PER_LINE) break;
        // Skip URL tails ("https://host/a", after ':' or '/') and relative tokens glued to a
        // word ("github.com/foo/bar").
        const before = match.index > 0 ? log.text[match.index - 1] : "";
        if (before === "/" || before === ":" || /[\w.]/.test(before)) continue;
        if (match[0].startsWith("//")) continue;
        matches.push({ start: match.index, raw: match[0] });
      }
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      void Promise.all(matches.map((m) => resolveCandidate(m.raw, cwd))).then((resolved) => {
        const links: ILink[] = [];
        resolved.forEach((target, i) => {
          if (!target) return;
          links.push({
            range: rangeOf(log, matches[i].start, target.path.length),
            text: target.path,
            decorations: { pointerCursor: true, underline: true },
            activate: (event) => {
              if (holdsLinkModifier(event)) onActivate(target);
            },
          });
        });
        callback(links.length > 0 ? links : undefined);
      });
    },
  };
}

/** Web addresses in output, opened with the same modifier gesture as paths. */
export function createUrlLinkProvider(options: {
  term: Terminal;
  onActivate: (url: string) => void;
}): ILinkProvider {
  const { term, onActivate } = options;
  return {
    provideLinks(y, callback) {
      const log = logicalLineAt(term, y);
      if (!log || !log.text.includes("://")) {
        callback(undefined);
        return;
      }
      const links: ILink[] = [];
      URL_CANDIDATE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = URL_CANDIDATE.exec(log.text)) !== null) {
        if (links.length >= MAX_LINKS_PER_LINE) break;
        const url = match[0].replace(URL_TRAILING_NOISE, "");
        if (url.length <= "https://".length) continue;
        links.push({
          range: rangeOf(log, match.index, url.length),
          text: url,
          decorations: { pointerCursor: true, underline: true },
          activate: (event) => {
            if (holdsLinkModifier(event)) onActivate(url);
          },
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}
