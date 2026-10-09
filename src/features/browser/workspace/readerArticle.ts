/** A page's article as reader mode shows it: plain blocks, never page markup. */
export type ReaderBlock =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph" | "quote" | "code"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "image"; src: string; alt: string; caption: string };

export interface ReaderArticle {
  title: string;
  byline: string;
  site: string;
  url: string;
  words: number;
  blocks: ReaderBlock[];
}

const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

/** The page's extraction is untrusted: anything malformed is dropped. */
export function parseReaderArticle(value: unknown): ReaderArticle | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const blocks: ReaderBlock[] = [];
  for (const item of Array.isArray(raw.blocks) ? raw.blocks.slice(0, 1500) : []) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    switch (block.type) {
      case "heading": {
        const level = block.level === 3 || block.level === 4 ? block.level : 2;
        if (text(block.text, 1000))
          blocks.push({ type: "heading", level, text: text(block.text, 1000) });
        break;
      }
      case "paragraph":
      case "quote":
      case "code":
        if (text(block.text, 20000))
          blocks.push({ type: block.type, text: text(block.text, 20000) });
        break;
      case "list": {
        const items = Array.isArray(block.items)
          ? block.items
              .map((entry) => text(entry, 5000))
              .filter(Boolean)
              .slice(0, 200)
          : [];
        if (items.length) blocks.push({ type: "list", ordered: block.ordered === true, items });
        break;
      }
      case "image": {
        const src = text(block.src, 4096);
        if (/^https:\/\//.test(src))
          blocks.push({
            type: "image",
            src,
            alt: text(block.alt, 500),
            caption: text(block.caption, 1000),
          });
        break;
      }
    }
  }
  const words = typeof raw.words === "number" && Number.isFinite(raw.words) ? raw.words : 0;
  // Pages with almost no prose have nothing worth reading this way.
  if (words < 60 || !blocks.some((block) => block.type === "paragraph")) return null;
  return {
    title: text(raw.title, 300),
    byline: text(raw.byline, 200),
    site: text(raw.site, 200),
    url: text(raw.url, 4096),
    words,
    blocks,
  };
}
