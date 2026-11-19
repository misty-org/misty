import { isEmbedKind, type EmbedReference } from "./embedTypes";

/*
 * The markdown form of an embed, so agents (and markdown export and import) can write one:
 *
 *   ::embed{kind=data-chart id=wb_123 part=chart_9}
 *   ::embed{kind=data-range id=wb_123 part="sheet_1!{r:a,c:b}:{r:c,c:d}" title="Q3 numbers"}
 *
 * A value that holds anything besides letters, digits and `_ . : -` is quoted, with `\"` and
 * `\\` escaped. The directive stands alone on its line.
 */

const plainValue = /^[A-Za-z0-9_.:-]+$/;

/** One directive at the start of `src`, up to and including its line break. */
export const embedDirectivePattern = /^::embed\{((?:[^}"\n]|"(?:[^"\\\n]|\\.)*")*)\}[ \t]*(?:\n|$)/;

const attributePattern = /([A-Za-z_][\w-]*)=("(?:[^"\\\n]|\\.)*"|[^\s"}]+)/g;

function quote(value: string): string {
  return plainValue.test(value) ? value : `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  return value.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** The directive for one embed, without a line break. */
export function formatEmbedDirective(embed: EmbedReference): string {
  const parts = [
    `kind=${quote(embed.kind)}`,
    `id=${quote(embed.item_id)}`,
    `part=${quote(embed.part_id)}`,
  ];
  if (embed.title) parts.push(`title=${quote(embed.title.replace(/\n+/g, " "))}`);
  return `::embed{${parts.join(" ")}}`;
}

/** Reads a directive's attribute text (what sits between the braces). */
export function parseEmbedAttributes(source: string): EmbedReference | null {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(attributePattern)) {
    attributes[match[1]!] = unquote(match[2]!);
  }
  const kind = attributes.kind;
  const itemId = attributes.id ?? attributes.item_id;
  const partId = attributes.part ?? attributes.part_id;
  if (!isEmbedKind(kind) || !itemId || !partId) return null;
  return {
    kind,
    item_id: itemId,
    part_id: partId,
    ...(attributes.title ? { title: attributes.title } : {}),
  };
}

/** The directive at the start of `src`, with the text it spans; null when there is none. */
export function readEmbedDirective(src: string): { embed: EmbedReference; raw: string } | null {
  const match = embedDirectivePattern.exec(src);
  if (!match) return null;
  const embed = parseEmbedAttributes(match[1] ?? "");
  return embed ? { embed, raw: match[0] } : null;
}

/** Where the next directive at the start of a line begins in `src`, or -1. */
export function embedDirectiveStart(src: string): number {
  const match = /(^|\n)::embed\{/.exec(src);
  if (!match) return -1;
  return match.index + match[1]!.length;
}

/** Every embed a markdown text names, in order, e.g. to check them before an agent's write. */
export function findEmbedDirectives(markdown: string): EmbedReference[] {
  const found: EmbedReference[] = [];
  for (const line of markdown.split("\n")) {
    const directive = readEmbedDirective(line.trimStart());
    if (directive) found.push(directive.embed);
  }
  return found;
}
