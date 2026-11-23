import { useEffect, useState } from "react";
import type { ThemedToken } from "shiki/core";
import { codeLanguage } from "@/shared/lib/highlight/code_languages";

type Lines = ThemedToken[][];

const LIMIT = { entries: 64, characters: 300_000 };
const cache = new Map<string, Lines>();
let cachedCharacters = 0;

const keyOf = (code: string, language: string) => `${language}\u0000${code}`;

function remember(key: string, lines: Lines) {
  if (key.length > LIMIT.characters) return;
  while (cache.size >= LIMIT.entries || cachedCharacters + key.length > LIMIT.characters) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
    cachedCharacters -= oldest.length;
  }
  cache.set(key, lines);
  cachedCharacters += key.length;
}

async function tokenize(code: string, language: string): Promise<Lines> {
  const { tokenize } = await import("@/shared/lib/highlight/shiki_highlighter");
  return tokenize(code, language);
}

export function closedFence(raw: string): boolean {
  const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*\r?\n/.exec(raw);
  if (!opening) return false;
  const lastLine = raw.slice(raw.lastIndexOf("\n") + 1).replace(/\r$/, "");
  const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lastLine);
  return !!closing && closing[1][0] === opening[1][0] && closing[1].length >= opening[1].length;
}

export function useCodeTokens(code: string, language: string | undefined, settled: boolean) {
  const id = codeLanguage(language);
  const key = id ? keyOf(code, id) : "";
  const known = key ? cache.get(key) : undefined;
  const [loaded, setLoaded] = useState<{ key: string; lines: Lines }>();
  useEffect(() => {
    if (!id || !settled || cache.has(key)) return;
    let alive = true;
    void tokenize(code, id)
      .then((lines) => {
        remember(key, lines);
        if (alive) setLoaded({ key, lines });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code, id, key, settled]);
  if (!settled) return undefined;
  return known ?? (loaded?.key === key ? loaded.lines : undefined);
}
