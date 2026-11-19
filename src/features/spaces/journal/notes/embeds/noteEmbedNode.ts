import { mergeAttributes, Node, type JSONContent } from "@tiptap/core";
import {
  embedDirectiveStart,
  formatEmbedDirective,
  readEmbedDirective,
} from "../../../embeds/embedDirective";
import { isEmbedKind, type EmbedReference } from "../../../embeds/embedTypes";

/** The Tiptap node for a live embed. Its attributes are the reference, nothing of the source. */
export const noteEmbedNodeName = "mistyEmbed";

export interface NoteEmbedAttributes {
  kind: EmbedReference["kind"] | null;
  itemId: string | null;
  partId: string | null;
  title: string;
}

/** The reference a node's attributes hold, or null for a broken one. */
export function embedFromAttributes(
  attrs: Partial<NoteEmbedAttributes> | undefined,
): EmbedReference | null {
  if (!attrs || !isEmbedKind(attrs.kind) || !attrs.itemId || !attrs.partId) return null;
  return {
    kind: attrs.kind,
    item_id: attrs.itemId,
    part_id: attrs.partId,
    ...(attrs.title ? { title: attrs.title } : {}),
  };
}

export function embedAttributes(embed: EmbedReference): NoteEmbedAttributes {
  return {
    kind: embed.kind,
    itemId: embed.item_id,
    partId: embed.part_id,
    title: embed.title ?? "",
  };
}

/** The node's JSON for inserting an embed. */
export function noteEmbedContent(embed: EmbedReference): JSONContent {
  return { type: noteEmbedNodeName, attrs: embedAttributes(embed) };
}

const dataAttribute = (name: string, attribute: string) => ({
  default: name === "title" ? "" : null,
  parseHTML: (element: HTMLElement) =>
    element.getAttribute(attribute) ?? (name === "title" ? "" : null),
  renderHTML: (attributes: Record<string, unknown>) =>
    attributes[name] ? { [attribute]: String(attributes[name]) } : {},
});

/**
 * The embed node with its schema, HTML and markdown (`::embed{…}`) forms. The editor extends it
 * with a live view; headless conversion (tool sessions, export, import) uses it as it is.
 */
export const NoteEmbed = Node.create({
  name: noteEmbedNodeName,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: dataAttribute("kind", "data-kind"),
      itemId: dataAttribute("itemId", "data-item-id"),
      partId: dataAttribute("partId", "data-part-id"),
      title: dataAttribute("title", "data-title"),
    };
  },

  parseHTML() {
    return [{ tag: "div[data-misty-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-misty-embed": "" }, HTMLAttributes)];
  },

  markdownTokenName: noteEmbedNodeName,

  markdownTokenizer: {
    name: noteEmbedNodeName,
    level: "block",
    start: (src: string) => embedDirectiveStart(src),
    tokenize(src: string) {
      const directive = readEmbedDirective(src);
      if (!directive) return undefined;
      return { type: noteEmbedNodeName, raw: directive.raw, embed: directive.embed };
    },
  },

  parseMarkdown(token, helpers) {
    const embed = token.embed as EmbedReference | undefined;
    if (!embed) return [];
    return helpers.createNode(noteEmbedNodeName, embedAttributes(embed));
  },

  renderMarkdown(node) {
    const embed = embedFromAttributes(node.attrs as Partial<NoteEmbedAttributes>);
    return embed ? formatEmbedDirective(embed) : "";
  },
});
