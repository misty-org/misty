/**
 * Readable text from a fetched page, for `web.fetch` (docs/plans/agent-harness.md,
 * phase 1). The HTML is parsed into an inert document: nothing in it runs or
 * loads. Navigation, scripts and page chrome are dropped; headings, paragraphs,
 * lists and table rows become plain Markdown-like lines. A long page returns the
 * parts that best match what the agent asked for, in page order.
 */
const dropped = [
  "script,style,noscript,template,svg,canvas,iframe,form",
  "nav,header,footer,aside,button,select,[hidden],[aria-hidden=true]",
  "[role=navigation],[role=banner],[role=contentinfo]",
].join(",");
const blocks = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "LI",
  "TR",
  "PRE",
  "BLOCKQUOTE",
  "DT",
  "DD",
  "FIGCAPTION",
]);

export interface ReadablePage {
  title: string;
  text: string;
  /** Text was left out: the page was longer than the limit. */
  truncated: boolean;
}

function lines(root: Element): string[] {
  const out: string[] = [];
  const walk = (element: Element) => {
    if (blocks.has(element.tagName)) {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) return;
      if (/^H[1-6]$/.test(element.tagName))
        out.push(`${"#".repeat(Number(element.tagName[1]))} ${text}`);
      else if (element.tagName === "LI") out.push(`- ${text}`);
      else if (element.tagName === "TR")
        out.push(
          Array.from(element.children)
            .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
            .join(" | "),
        );
      else out.push(text);
      return;
    }
    for (const child of Array.from(element.children)) walk(child);
  };
  walk(root);
  // Pages with no block markup still have text.
  if (!out.length) {
    const text = (root.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/** The lines that best answer `question`, kept in page order, within `limit` characters. */
function relevant(all: string[], question: string, limit: number): string[] {
  const wanted = words(question);
  const scored = all.map((line, index) => {
    let score = 0;
    for (const word of words(line)) if (wanted.has(word)) score++;
    // Headings carry the context of the lines under them.
    return { index, score: line.startsWith("#") ? score + 0.5 : score };
  });
  const keep = new Set<number>();
  let size = 0;
  for (const { index, score } of [...scored].sort(
    (a, b) => b.score - a.score || a.index - b.index,
  )) {
    if (score <= 0 || size >= limit) break;
    for (const neighbour of [index - 1, index, index + 1]) {
      const line = all[neighbour];
      if (line === undefined || keep.has(neighbour)) continue;
      keep.add(neighbour);
      size += line.length + 1;
    }
  }
  return [...keep].sort((a, b) => a - b).map((index) => all[index]!);
}

export function readablePage(
  html: string,
  contentType: string,
  question: string,
  limit = 15_000,
): ReadablePage {
  if (!/html|xml/.test(contentType) && contentType !== "") {
    const text = html.trim();
    return { title: "", text: text.slice(0, limit), truncated: text.length > limit };
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of Array.from(document.querySelectorAll(dropped))) element.remove();
  const root =
    document.querySelector("main,article,[role=main]") ?? document.body ?? document.documentElement;
  const all = lines(root);
  const full = all.join("\n");
  if (full.length <= limit) return { title: document.title.trim(), text: full, truncated: false };
  const picked = question.trim() ? relevant(all, question, limit) : [];
  const text = (picked.length ? picked.join("\n") : full).slice(0, limit);
  return { title: document.title.trim(), text, truncated: true };
}
