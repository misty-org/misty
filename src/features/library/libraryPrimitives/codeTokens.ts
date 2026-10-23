export type CodeToken = {
  text: string;
  kind: "plain" | "keyword" | "string" | "comment" | "number";
};

const KEYWORDS = new Set(
  (
    "as async await break case catch class const continue def default defer delete do elif else enum " +
    "export extends false fn for from func function go if impl import in interface let match mod new " +
    "nil none null package pub return self static struct super switch this throw true try type var " +
    "void while with yield"
  ).split(" "),
);

const PATTERN =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Splits source into a few broad token kinds for a monochrome highlight: the
 * shades differ by contrast, never by hue. Good enough for a preview card; it
 * doesn't parse any language.
 */
export function codeTokens(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let last = 0;
  for (const match of source.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: source.slice(last, index), kind: "plain" });
    const [text, comment, string, number, word] = match;
    tokens.push({
      text,
      kind: comment
        ? "comment"
        : string
          ? "string"
          : number
            ? "number"
            : word && KEYWORDS.has(word)
              ? "keyword"
              : "plain",
    });
    last = index + text.length;
  }
  if (last < source.length) tokens.push({ text: source.slice(last), kind: "plain" });
  return tokens;
}

/** The first rows and columns of a CSV or TSV file, for a preview table. */
export function csvPreview(source: string, rows = 6, columns = 4): string[][] {
  const delimiter = source.split("\n", 1)[0].includes("\t") ? "\t" : ",";
  const out: string[][] = [];
  for (const line of source.split(/\r?\n/)) {
    if (out.length >= rows) break;
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(cell);
        cell = "";
      } else cell += char;
    }
    cells.push(cell);
    out.push(cells.slice(0, columns));
  }
  return out;
}
