import type {
  NotionBlock,
  NotionCreatePagePayload,
  NotionDatabase,
  NotionPage,
  NotionPropertyValue,
  NotionRichText,
} from "@/models/interfaces/features/notes/notion";

/**
 * Markdown ↔ Notion block translation.
 *
 * Beta deliberately covers the common block set rather than attempting faithful
 * round-tripping of arbitrary Notion documents. Anything richer is preserved as
 * readable text instead of being silently dropped, so a Misty write-back never
 * destroys structure it did not understand.
 */

/** Notion rejects any rich-text chunk longer than this. */
const RICH_TEXT_LIMIT = 2000;
/** Notion accepts at most this many children per append request. */
export const NOTION_APPEND_LIMIT = 100;

export function richText(content: string): NotionRichText[] {
  if (!content) return [];
  // Long paragraphs must be split, not truncated: losing a user's words on a
  // write-back would be worse than an extra chunk boundary.
  const chunks: NotionRichText[] = [];
  for (let index = 0; index < content.length; index += RICH_TEXT_LIMIT) {
    chunks.push({ type: "text", text: { content: content.slice(index, index + RICH_TEXT_LIMIT) } });
  }
  return chunks;
}

export function plainText(spans: NotionRichText[] | undefined): string {
  return (spans ?? []).map((span) => span.plain_text ?? span.text?.content ?? "").join("");
}

/** Markdown → Notion blocks. Unknown syntax degrades to a paragraph. */
export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // Fenced code survives verbatim — reflowing someone's snippet would break it.
    const fence = /^```(\w*)\s*$/.exec(trimmed);
    if (fence) {
      const language = fence[1] || "plain text";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", code: { rich_text: richText(body.join("\n")), language } });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "divider", divider: {} });
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      // Notion stops at heading_3; deeper markdown headings clamp to it.
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      const type = `heading_${level}` as const;
      blocks.push({ type, [type]: { rich_text: richText(heading[2]) } } as NotionBlock);
      index += 1;
      continue;
    }

    const todo = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(trimmed);
    if (todo) {
      blocks.push({
        type: "to_do",
        to_do: { rich_text: richText(todo[2]), checked: todo[1].toLowerCase() === "x" },
      });
      index += 1;
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText(bullet[1]) },
      });
      index += 1;
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      blocks.push({
        type: "numbered_list_item",
        numbered_list_item: { rich_text: richText(numbered[1]) },
      });
      index += 1;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      blocks.push({ type: "quote", quote: { rich_text: richText(quote[1]) } });
      index += 1;
      continue;
    }

    blocks.push({ type: "paragraph", paragraph: { rich_text: richText(trimmed) } });
    index += 1;
  }

  return blocks;
}

/** Notion blocks → markdown, for reading Notion content into Misty. */
export function notionBlocksToMarkdown(blocks: NotionBlock[]): string {
  const lines = blocks.map((block) => {
    switch (block.type) {
      case "heading_1":
        return `# ${plainText(block.heading_1?.rich_text)}`;
      case "heading_2":
        return `## ${plainText(block.heading_2?.rich_text)}`;
      case "heading_3":
        return `### ${plainText(block.heading_3?.rich_text)}`;
      case "bulleted_list_item":
        return `- ${plainText(block.bulleted_list_item?.rich_text)}`;
      case "numbered_list_item":
        return `1. ${plainText(block.numbered_list_item?.rich_text)}`;
      case "to_do":
        return `- [${block.to_do?.checked ? "x" : " "}] ${plainText(block.to_do?.rich_text)}`;
      case "quote":
        return `> ${plainText(block.quote?.rich_text)}`;
      case "code":
        return `\`\`\`${block.code?.language ?? ""}\n${plainText(block.code?.rich_text)}\n\`\`\``;
      case "divider":
        return "---";
      default:
        return plainText(block.paragraph?.rich_text);
    }
  });
  return lines.join("\n\n").trim();
}

/** Pulls a page's display title out of whichever property holds it. */
export function notionPageTitle(page: NotionPage): string {
  if (page.title?.length) return plainText(page.title).trim() || "Untitled";
  const titleProperty = Object.values(page.properties ?? {}).find(
    (property) => property.type === "title",
  );
  if (titleProperty && titleProperty.type === "title") {
    return plainText(titleProperty.title).trim() || "Untitled";
  }
  return "Untitled";
}

export function notionDatabaseTitle(database: NotionDatabase): string {
  return plainText(database.title).trim() || "Untitled database";
}

/**
 * Builds a create-page payload. A database parent must carry its title under the
 * database's own title property name, which is why the caller passes it in.
 */
export function buildCreatePagePayload(input: {
  title: string;
  markdown: string;
  parentPageId?: string;
  parentDatabaseId?: string;
  titlePropertyName?: string;
  properties?: Record<string, NotionPropertyValue>;
}): NotionCreatePagePayload {
  if (!input.parentPageId && !input.parentDatabaseId) {
    throw new Error("Choose a Notion page or database to publish into.");
  }
  const titleProperty = input.parentDatabaseId ? (input.titlePropertyName ?? "Name") : "title";
  return {
    parent: input.parentDatabaseId
      ? { database_id: input.parentDatabaseId }
      : { page_id: input.parentPageId as string },
    properties: {
      [titleProperty]: { type: "title", title: richText(input.title.trim() || "Untitled") },
      ...(input.properties ?? {}),
    },
    children: markdownToNotionBlocks(input.markdown),
  };
}

/**
 * Renders a Misty task list as Notion to-do blocks. This is the shape used when
 * publishing a Space's tasks into a Notion page.
 */
export function taskListToNotionBlocks(
  tasks: Array<{ title: string; done: boolean }>,
): NotionBlock[] {
  return tasks.map((task) => ({
    type: "to_do" as const,
    to_do: { rich_text: richText(task.title), checked: task.done },
  }));
}

/** Notion property types Misty is willing to write. */
const WRITABLE_PROPERTY_TYPES = new Set([
  "title",
  "rich_text",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "number",
  "url",
]);

/**
 * Shapes a property patch against a database's real schema.
 *
 * Properties the schema does not declare — or declares as a type Misty cannot
 * safely express, like a rollup or relation — are reported as `skipped` rather
 * than guessed at, so a write-back never corrupts a column it misread.
 */
export function buildPropertyPatch(
  schema: NotionDatabase["properties"],
  values: Record<string, string | number | boolean | string[]>,
): { properties: Record<string, NotionPropertyValue>; skipped: string[] } {
  const properties: Record<string, NotionPropertyValue> = {};
  const skipped: string[] = [];

  for (const [name, value] of Object.entries(values)) {
    const declared = schema?.[name];
    if (!declared || !WRITABLE_PROPERTY_TYPES.has(declared.type)) {
      skipped.push(name);
      continue;
    }
    const shaped = shapeProperty(declared.type, value);
    if (shaped) properties[name] = shaped;
    else skipped.push(name);
  }

  return { properties, skipped };
}

function shapeProperty(
  type: string,
  value: string | number | boolean | string[],
): NotionPropertyValue | undefined {
  switch (type) {
    case "title":
      return { type: "title", title: richText(String(value)) };
    case "rich_text":
      return { type: "rich_text", rich_text: richText(String(value)) };
    case "select":
      return { type: "select", select: value ? { name: String(value) } : null };
    case "multi_select":
      return {
        type: "multi_select",
        multi_select: (Array.isArray(value) ? value : [String(value)])
          .filter(Boolean)
          .map((name) => ({ name: String(name) })),
      };
    case "date": {
      const start = String(value);
      // An unparseable date is skipped, never sent as a malformed string.
      return Number.isNaN(Date.parse(start)) ? undefined : { type: "date", date: { start } };
    }
    case "checkbox":
      return { type: "checkbox", checkbox: Boolean(value) };
    case "number": {
      const parsed = typeof value === "number" ? value : Number(value);
      return Number.isFinite(parsed) ? { type: "number", number: parsed } : undefined;
    }
    case "url":
      return { type: "url", url: value ? String(value) : null };
    default:
      return undefined;
  }
}

/** Splits an append into Notion-sized batches. */
export function chunkBlocks(blocks: NotionBlock[], size = NOTION_APPEND_LIMIT): NotionBlock[][] {
  const batches: NotionBlock[][] = [];
  for (let index = 0; index < blocks.length; index += size) {
    batches.push(blocks.slice(index, index + size));
  }
  return batches;
}
