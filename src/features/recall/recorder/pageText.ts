interface ArticleBlock {
  type: string;
  text?: string;
  items?: string[];
}

/** The reader article as plain text, headings and lists kept as lines. */
export function articleText(article: unknown, limit = 20_000) {
  const blocks = (article as { blocks?: ArticleBlock[] } | null)?.blocks ?? [];
  const lines: string[] = [];
  let size = 0;
  for (const block of blocks) {
    if (block.type === "image" || block.type === "code") continue;
    const parts = block.items?.length ? block.items.map((item) => `- ${item}`) : [block.text ?? ""];
    for (const part of parts) {
      const line = part.replace(/\s+/g, " ").trim();
      if (!line) continue;
      lines.push(line);
      size += line.length + 1;
      if (size >= limit) return lines.join("\n").slice(0, limit);
    }
  }
  return lines.join("\n");
}
