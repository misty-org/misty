/**
 * Hover and completion docs arrive as Markdown, which may carry raw HTML. A server is a program
 * from the internet reading the person's files, so what it sends is shown as text and simple
 * formatting only: no scripts, frames, images, forms or links (a link would navigate the
 * window), and no attributes but the highlighter's classes.
 */
const KEPT = new Set([
  "P",
  "PRE",
  "CODE",
  "SPAN",
  "DIV",
  "EM",
  "STRONG",
  "B",
  "I",
  "DEL",
  "S",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "HR",
  "BR",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
]);

/** Tags dropped with everything in them; any other unknown tag keeps its text. */
const DROPPED = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "IMG",
  "PICTURE",
  "VIDEO",
  "AUDIO",
  "SVG",
  "MATH",
  "TEMPLATE",
  "LINK",
  "META",
  "BASE",
  "FORM",
  "INPUT",
  "BUTTON",
  "TEXTAREA",
  "SELECT",
  "NOSCRIPT",
]);

function clean(parent: Element): void {
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName.toUpperCase();
    if (DROPPED.has(tag)) {
      child.remove();
      continue;
    }
    clean(child);
    if (!KEPT.has(tag)) {
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const attribute of Array.from(child.attributes)) {
      if (attribute.name !== "class") child.removeAttribute(attribute.name);
    }
  }
}

/** The HTML a language server's docs render to, made safe to put in the page. */
export function sanitizeServerHtml(html: string): string {
  // DOMParser builds an inert document: nothing in it loads or runs while it is cleaned.
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  clean(document.body);
  return document.body.innerHTML;
}
