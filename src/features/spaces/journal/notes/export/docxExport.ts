import type { JSONContent } from "@tiptap/core";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import { embedPlaceholder, inlineRuns, startsWithTitle, type DocRun } from "./docRuns";
import type { ExportImage, ResolveExportImage } from "./exportImages";

/*
 * A doc as a Word file (`docx`, MIT): headings, paragraphs with their marks and links, bulleted,
 * numbered and to-do lists, quotes, code, tables, images and a line for each embed.
 */

const orderedReference = "misty-ordered";
const codeFont = "Courier New";
/** Widest an image is placed, in pixels at 96 to the inch (a page's text width). */
const maxImageWidth = 600;

const headingLevels = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

type Block = Paragraph | Table;

interface Context {
  images: Map<string, ExportImage | null>;
  nextList: () => number;
}

type ParagraphOptions = IParagraphOptions;

function textRun(run: DocRun, extra?: { bold?: boolean; italics?: boolean }): TextRun {
  if (run.break) return new TextRun({ text: "", break: 1 });
  return new TextRun({
    text: run.text,
    bold: run.bold || extra?.bold,
    italics: run.italic || extra?.italics,
    underline: run.underline ? {} : undefined,
    strike: run.strike,
    superScript: run.superscript,
    subScript: run.subscript,
    font: run.code ? codeFont : undefined,
  });
}

function children(
  content: readonly JSONContent[] | undefined,
  extra?: { bold?: boolean; italics?: boolean },
): ParagraphChild[] {
  return inlineRuns(content).map((run) =>
    run.link
      ? new ExternalHyperlink({
          link: run.link,
          children: [
            new TextRun({
              text: run.text,
              style: "Hyperlink",
              bold: run.bold || extra?.bold,
              italics: run.italic || extra?.italics,
            }),
          ],
        })
      : textRun(run, extra),
  );
}

function alignment(node: JSONContent) {
  const align = node.attrs?.textAlign;
  if (align === "center") return AlignmentType.CENTER;
  if (align === "right") return AlignmentType.RIGHT;
  if (align === "justify") return AlignmentType.JUSTIFIED;
  return undefined;
}

function collectImages(node: JSONContent, into: Set<string>) {
  if (node.type === "image" && typeof node.attrs?.src === "string") into.add(node.attrs.src);
  for (const child of node.content ?? []) collectImages(child, into);
}

function imageParagraph(node: JSONContent, context: Context, base: Partial<ParagraphOptions>) {
  const src = String(node.attrs?.src ?? "");
  const image = context.images.get(src);
  const alt = String(node.attrs?.alt ?? "").trim();
  if (!image)
    return new Paragraph({
      ...base,
      children: [new TextRun({ text: alt ? `[${alt}]` : "[Image]", italics: true })],
    });
  const scale = Math.min(1, maxImageWidth / Math.max(1, image.width));
  return new Paragraph({
    ...base,
    children: [
      new ImageRun({
        type: "png",
        data: image.data,
        transformation: {
          width: Math.round(image.width * scale),
          height: Math.round(image.height * scale),
        },
        altText: alt ? { name: alt, description: alt, title: alt } : undefined,
      }),
    ],
  });
}

/** The blocks of a list item's content, with the list's marker on its first paragraph. */
function listItemBlocks(
  item: JSONContent,
  context: Context,
  marker: (first: boolean) => Partial<ParagraphOptions>,
  level: number,
  prefix?: string,
): Block[] {
  const blocks: Block[] = [];
  let first = true;
  for (const child of item.content ?? []) {
    if (child.type === "paragraph") {
      const runs = children(child.content);
      blocks.push(
        new Paragraph({
          ...marker(first),
          children: first && prefix ? [new TextRun({ text: prefix }), ...runs] : runs,
        }),
      );
      first = false;
      continue;
    }
    blocks.push(...nodeBlocks(child, context, level + 1));
    first = false;
  }
  return blocks;
}

function nodeBlocks(node: JSONContent, context: Context, level = 0): Block[] {
  const indent = level ? { left: 360 * level } : undefined;
  switch (node.type) {
    case "paragraph":
      return [
        new Paragraph({ children: children(node.content), alignment: alignment(node), indent }),
      ];
    case "heading": {
      const depth = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return [
        new Paragraph({
          heading: headingLevels[depth - 1],
          alignment: alignment(node),
          children: children(node.content),
        }),
      ];
    }
    case "bulletList":
      return (node.content ?? []).flatMap((item) =>
        listItemBlocks(item, context, () => ({ bullet: { level: Math.min(level, 8) } }), level),
      );
    case "orderedList": {
      const instance = context.nextList();
      return (node.content ?? []).flatMap((item) =>
        listItemBlocks(
          item,
          context,
          () => ({
            numbering: { reference: orderedReference, level: Math.min(level, 8), instance },
          }),
          level,
        ),
      );
    }
    case "taskList":
      return (node.content ?? []).flatMap((item) =>
        listItemBlocks(
          item,
          context,
          () => ({ indent: { left: 360 * (level + 1) } }),
          level,
          item.attrs?.checked ? "☑ " : "☐ ",
        ),
      );
    case "blockquote":
      return (node.content ?? []).flatMap((child) =>
        child.type === "paragraph"
          ? [
              new Paragraph({
                indent: { left: 720 + 360 * level },
                border: { left: { style: BorderStyle.SINGLE, size: 12, color: "auto", space: 12 } },
                children: children(child.content, { italics: true }),
              }),
            ]
          : nodeBlocks(child, context, level + 1),
      );
    case "codeBlock": {
      const text = (node.content ?? []).map((child) => child.text ?? "").join("");
      return text.split("\n").map(
        (line) =>
          new Paragraph({
            indent,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: line || " ", font: codeFont, size: 20 })],
          }),
      );
    }
    case "horizontalRule":
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } },
          children: [],
        }),
      ];
    case "image":
      return [imageParagraph(node, context, { indent })];
    case "mistyEmbed":
      return [
        new Paragraph({
          indent,
          children: [new TextRun({ text: `[${embedPlaceholder(node.attrs)}]`, italics: true })],
        }),
      ];
    case "table": {
      const rows = (node.content ?? []).filter((row) => row.type === "tableRow");
      if (!rows.length) return [];
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (row) =>
              new TableRow({
                tableHeader: (row.content ?? []).every((cell) => cell.type === "tableHeader"),
                children: (row.content ?? []).map((cell) => {
                  const header = cell.type === "tableHeader";
                  const blocks = (cell.content ?? []).flatMap((child) =>
                    child.type === "paragraph"
                      ? [new Paragraph({ children: children(child.content, { bold: header }) })]
                      : nodeBlocks(child, context),
                  );
                  return new TableCell({
                    columnSpan: Number(cell.attrs?.colspan ?? 1) || 1,
                    rowSpan: Number(cell.attrs?.rowspan ?? 1) || 1,
                    children: blocks.length ? blocks : [new Paragraph({ children: [] })],
                  });
                }),
              }),
          ),
        }),
      ];
    }
    default:
      return (node.content ?? []).flatMap((child) => nodeBlocks(child, context, level));
  }
}

/** The Word document for a doc, before it is packed into a file. */
export async function buildNoteDocx(
  title: string,
  json: JSONContent,
  resolveImage?: ResolveExportImage,
): Promise<Document> {
  const sources = new Set<string>();
  collectImages(json, sources);
  const images = new Map<string, ExportImage | null>();
  await Promise.all(
    [...sources].map(async (src) => images.set(src, resolveImage ? await resolveImage(src) : null)),
  );
  let lists = 0;
  const context: Context = { images, nextList: () => ++lists };
  const body = (json.content ?? []).flatMap((node) => nodeBlocks(node, context));
  const heading =
    title && !startsWithTitle(json, title)
      ? [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] })]
      : [];
  return new Document({
    title: title || undefined,
    numbering: {
      config: [
        {
          reference: orderedReference,
          levels: Array.from({ length: 9 }, (_, depth) => ({
            level: depth,
            format: LevelFormat.DECIMAL,
            text: `%${depth + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 360 * (depth + 1), hanging: 260 } } },
          })),
        },
      ],
    },
    sections: [{ children: [...heading, ...body] }],
  });
}

/** A doc as a .docx file. */
export async function noteDocxBlob(
  title: string,
  json: JSONContent,
  resolveImage?: ResolveExportImage,
): Promise<Blob> {
  return Packer.toBlob(await buildNoteDocx(title, json, resolveImage));
}
