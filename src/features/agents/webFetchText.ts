/**
 * Readable text from a fetched page, for `web.fetch` (docs/agents/harness.md,
 * Reading without a screen). The HTML is parsed into an inert document: nothing in it runs or
 * loads. Navigation, scripts and page chrome are dropped; every other visible
 * text becomes one plain line per block (headings and list items keep their
 * Markdown marks, table rows join their cells with "|"), so prices that sit in
 * plain divs and spans, as on most pricing pages, are kept. A long page returns
 * the parts that best match what the agent asked for, in page order.
 */
const dropped = [
  "script,style,noscript,template,svg,canvas,iframe",
  "nav,header,footer,aside,select,[hidden]",
  "[role=navigation],[role=banner],[role=contentinfo]",
].join(",");
const blocks = new Set([
  "ADDRESS",
  "ARTICLE",
  "BLOCKQUOTE",
  "BR",
  "BUTTON",
  "CAPTION",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "LABEL",
  "LEGEND",
  "LI",
  "MAIN",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "THEAD",
  "TR",
  "UL",
]);

/**
 * Pricing pages draw one billing period (usually yearly) until a toggle is switched, and a
 * fetch can't switch it. When the text has prices and names a billing period, say so.
 */
export function billingNote(text: string): string | undefined {
  if (
    !/[$€£]\s?\d/.test(text) ||
    !/\b(annual(ly)?|yearly|per year|billed monthly|month-to-month|monthly)\b/i.test(text)
  )
    return undefined;
  return (
    "Prices here show the billing period the page opens on (often yearly) and the " +
    "page's monthly/yearly toggle cannot be switched by a fetch. State which period " +
    "each price is for. To read the other period, call screen_open with this page's " +
    "url, which opens your own tab in the background and keeps this run going, then " +
    "switch the toggle with browser_steps."
  );
}

/**
 * A page a fetch can't read: an error, a sign-in wall or a script-only shell with little
 * text. The agent's own browser tab can (docs/agents/evals/odysseys.md).
 */
export function browserNote(status: number, text: string): string | undefined {
  const shell =
    /enable javascript|javascript is (required|disabled)|requires javascript|please turn on javascript/i;
  if (status < 400 && text.replace(/\s+/g, " ").length >= 600 && !shell.test(text))
    return undefined;
  return (
    "This page did not give its content to a fetch (it needs a browser, an account " +
    "or is blocked). To read or use it, call screen_open with this url: it opens " +
    "your own browser tab in the background and this run keeps going with browser " +
    "tools."
  );
}

interface ReadablePage {
  title: string;
  text: string;
  /** Text was left out: the page was longer than the limit. */
  truncated: boolean;
}

function lines(root: Element): string[] {
  const out: string[] = [];
  let buffer = "";
  let prefix = "";
  const flush = () => {
    const text = buffer
      .replace(/\s+/g, " ")
      .replace(/(\s*\|)+\s*$/, "")
      .trim();
    buffer = "";
    if (!text || /^[\s|\-–—•·]*$/.test(text)) {
      prefix = "";
      return;
    }
    if (out[out.length - 1] !== prefix + text) out.push(prefix + text);
    prefix = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      buffer += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    // Text a script hides from view but keeps for screen readers (prices drawn by a counter)
    // lives in a sibling that stays; the drawn copy is the one marked aria-hidden.
    if (element.getAttribute("aria-hidden") === "true") return;
    const tag = element.tagName;
    const block = blocks.has(tag);
    if (block) {
      flush();
      if (/^H[1-6]$/.test(tag)) prefix = `${"#".repeat(Number(tag[1]))} `;
      else if (tag === "LI") prefix = "- ";
    }
    for (const child of Array.from(element.childNodes)) walk(child);
    if (tag === "TD" || tag === "TH") buffer += " | ";
    if (block) flush();
  };
  walk(root);
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
  const body = document.body ?? document.documentElement;
  // The page's main area, unless it holds only a small part of the text (pricing cards often
  // sit beside it, in plain sections).
  const main = document.querySelector("main,article,[role=main]");
  const size = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").length;
  const root = main && size(main) >= size(body) * 0.6 ? main : body;
  const all = lines(root);
  const full = all.join("\n");
  if (full.length <= limit) return { title: document.title.trim(), text: full, truncated: false };
  const picked = question.trim() ? relevant(all, question, limit) : [];
  const text = (picked.length ? picked.join("\n") : full).slice(0, limit);
  return { title: document.title.trim(), text, truncated: true };
}
