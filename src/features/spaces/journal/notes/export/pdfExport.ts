import type { JSONContent } from "@tiptap/core";
import {
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { embedPlaceholder, inlineRuns, startsWithTitle, type DocRun } from "./docRuns";
import type { ResolveExportImage } from "./exportImages";

/** An image embedded in the PDF ahead of layout, with its size in pixels. */
interface PlacedImage {
  image: PDFImage;
  width: number;
  height: number;
}

/*
 * A doc as a PDF (`pdf-lib`, MIT), laid out here block by block on Letter pages: headings,
 * wrapped paragraphs with bold, italic and code runs, lists, quotes, code, tables, images and a
 * line for each embed. The standard PDF fonts carry Latin text; a character they can't draw is
 * written as "?".
 */

const pageSize: [number, number] = [612, 792];
const margin = 64;
const contentWidth = pageSize[0] - margin * 2;
const bodySize = 11;
const lineGap = 1.45;
const ink = rgb(0.1, 0.1, 0.1);
const muted = rgb(0.42, 0.42, 0.42);
const rule = rgb(0.82, 0.82, 0.82);
const codeFill = rgb(0.95, 0.95, 0.95);
const headingSizes = [22, 18, 15, 13, 12, 11];

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
}

interface Style {
  size: number;
  bold?: boolean;
  italic?: boolean;
  color?: ReturnType<typeof rgb>;
}

/** One placed piece of a wrapped line. */
interface Piece {
  text: string;
  font: PDFFont;
  size: number;
  width: number;
  link?: string;
  underline?: boolean;
  strike?: boolean;
}

class Layout {
  page: PDFPage;
  y: number;
  private readonly drawable = new Map<PDFFont, Map<string, boolean>>();

  constructor(
    readonly pdf: PDFDocument,
    readonly fonts: Fonts,
    readonly images: Map<string, PlacedImage | null>,
  ) {
    this.page = pdf.addPage(pageSize);
    this.y = pageSize[1] - margin;
  }

  ensure(height: number) {
    if (this.y - height >= margin) return;
    this.page = this.pdf.addPage(pageSize);
    this.y = pageSize[1] - margin;
  }

  gap(points: number) {
    this.y -= points;
  }

  /** The text with what the font can't draw as "?". */
  safe(text: string, font: PDFFont): string {
    let known = this.drawable.get(font);
    if (!known) {
      known = new Map();
      this.drawable.set(font, known);
    }
    let out = "";
    for (const character of text.replace(/\t/g, "    ")) {
      let ok = known.get(character);
      if (ok === undefined) {
        try {
          font.encodeText(character);
          ok = true;
        } catch {
          ok = false;
        }
        known.set(character, ok);
      }
      out += ok ? character : "?";
    }
    return out;
  }

  fontFor(run: DocRun, style: Style): PDFFont {
    if (run.code) return this.fonts.mono;
    const bold = run.bold || style.bold;
    const italic = run.italic || style.italic;
    if (bold && italic) return this.fonts.boldItalic;
    if (bold) return this.fonts.bold;
    if (italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  /** Wraps runs into lines no wider than `width`. */
  wrap(runs: DocRun[], style: Style, width: number): Piece[][] {
    const lines: Piece[][] = [[]];
    let lineWidth = 0;
    const push = (piece: Piece) => {
      lines[lines.length - 1]!.push(piece);
      lineWidth += piece.width;
    };
    for (const run of runs) {
      if (run.break) {
        lines.push([]);
        lineWidth = 0;
        continue;
      }
      const font = this.fontFor(run, style);
      const size = run.superscript || run.subscript ? style.size * 0.75 : style.size;
      const words = this.safe(run.text, font).split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        const measure = font.widthOfTextAtSize(word, size);
        const space = /^\s+$/.test(word);
        if (lineWidth + measure > width && lineWidth > 0) {
          if (space) continue;
          lines.push([]);
          lineWidth = 0;
        }
        if (space && lineWidth === 0) continue;
        if (measure > width) {
          // A word longer than the line breaks where it must.
          let rest = word;
          while (rest) {
            let cut = rest.length;
            while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width - lineWidth)
              cut -= 1;
            const part = rest.slice(0, cut);
            push({
              text: part,
              font,
              size,
              width: font.widthOfTextAtSize(part, size),
              link: run.link,
              underline: run.underline || Boolean(run.link),
              strike: run.strike,
            });
            rest = rest.slice(cut);
            if (rest) {
              lines.push([]);
              lineWidth = 0;
            }
          }
          continue;
        }
        push({
          text: word,
          font,
          size,
          width: measure,
          link: run.link,
          underline: run.underline || Boolean(run.link),
          strike: run.strike,
        });
      }
    }
    return lines;
  }

  /** Writes wrapped runs at `x`, moving down; returns nothing but keeps `y` below the text. */
  text(runs: DocRun[], style: Style, x: number, width: number) {
    const lineHeight = style.size * lineGap;
    for (const line of this.wrap(runs, style, width)) {
      this.ensure(lineHeight);
      const baseline = this.y - style.size;
      let cursor = x;
      for (const piece of line) {
        this.page.drawText(piece.text, {
          x: cursor,
          y: baseline,
          size: piece.size,
          font: piece.font,
          color: style.color ?? ink,
        });
        if (piece.underline)
          this.page.drawLine({
            start: { x: cursor, y: baseline - 1.5 },
            end: { x: cursor + piece.width, y: baseline - 1.5 },
            thickness: 0.6,
            color: style.color ?? ink,
          });
        if (piece.strike)
          this.page.drawLine({
            start: { x: cursor, y: baseline + piece.size * 0.3 },
            end: { x: cursor + piece.width, y: baseline + piece.size * 0.3 },
            thickness: 0.6,
            color: style.color ?? ink,
          });
        cursor += piece.width;
      }
      this.y -= lineHeight;
    }
  }

  /** The height wrapped runs will take. */
  measure(runs: DocRun[], style: Style, width: number): number {
    return this.wrap(runs, style, width).length * style.size * lineGap;
  }
}

function blocks(
  layout: Layout,
  nodes: readonly JSONContent[] | undefined,
  x: number,
  width: number,
) {
  for (const node of nodes ?? []) block(layout, node, x, width);
}

function listItems(
  layout: Layout,
  list: JSONContent,
  x: number,
  width: number,
  marker: (index: number, item: JSONContent) => string,
) {
  const indent = 18;
  (list.content ?? []).forEach((item, index) => {
    const label = marker(index, item);
    const firstLine = bodySize * lineGap;
    layout.ensure(firstLine);
    const top = layout.y;
    const page = layout.page;
    blocks(layout, item.content, x + indent, width - indent);
    page.drawText(layout.safe(label, layout.fonts.regular), {
      x,
      y: top - bodySize,
      size: bodySize,
      font: layout.fonts.regular,
      color: ink,
    });
  });
}

function block(layout: Layout, node: JSONContent, x: number, width: number) {
  switch (node.type) {
    case "paragraph": {
      const runs = inlineRuns(node.content);
      if (!runs.length) {
        layout.gap(bodySize * lineGap * 0.6);
        return;
      }
      layout.text(runs, { size: bodySize }, x, width);
      layout.gap(bodySize * 0.5);
      return;
    }
    case "heading": {
      const depth = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      const size = headingSizes[depth - 1]!;
      layout.gap(size * 0.4);
      layout.ensure(size * lineGap * 2);
      layout.text(inlineRuns(node.content), { size, bold: true }, x, width);
      layout.gap(size * 0.25);
      return;
    }
    case "bulletList":
      listItems(layout, node, x, width, () => "•");
      layout.gap(bodySize * 0.3);
      return;
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1) || 1;
      listItems(layout, node, x, width, (index) => `${start + index}.`);
      layout.gap(bodySize * 0.3);
      return;
    }
    case "taskList":
      listItems(layout, node, x, width, (_index, item) => (item.attrs?.checked ? "[x]" : "[ ]"));
      layout.gap(bodySize * 0.3);
      return;
    case "blockquote": {
      const top = layout.y;
      const page = layout.page;
      for (const child of node.content ?? []) {
        if (child.type === "paragraph") {
          layout.text(
            inlineRuns(child.content),
            { size: bodySize, italic: true, color: muted },
            x + 14,
            width - 14,
          );
          layout.gap(bodySize * 0.4);
        } else block(layout, child, x + 14, width - 14);
      }
      if (layout.page === page)
        page.drawLine({
          start: { x: x + 2, y: top },
          end: { x: x + 2, y: layout.y + bodySize * 0.4 },
          thickness: 1.5,
          color: rule,
        });
      return;
    }
    case "codeBlock": {
      const size = 9.5;
      const lineHeight = size * 1.4;
      const text = (node.content ?? []).map((child) => child.text ?? "").join("");
      const lines = text.split("\n");
      layout.gap(2);
      for (const line of lines) {
        const wrapped = layout.wrap([{ text: line || " ", code: true }], { size }, width - 16);
        for (const piece of wrapped) {
          layout.ensure(lineHeight);
          layout.page.drawRectangle({
            x,
            y: layout.y - lineHeight,
            width,
            height: lineHeight,
            color: codeFill,
          });
          let cursor = x + 8;
          for (const part of piece) {
            layout.page.drawText(part.text, {
              x: cursor,
              y: layout.y - size - 1,
              size,
              font: layout.fonts.mono,
              color: ink,
            });
            cursor += part.width;
          }
          layout.y -= lineHeight;
        }
      }
      layout.gap(bodySize * 0.6);
      return;
    }
    case "horizontalRule":
      layout.ensure(16);
      layout.gap(8);
      layout.page.drawLine({
        start: { x, y: layout.y },
        end: { x: x + width, y: layout.y },
        thickness: 0.75,
        color: rule,
      });
      layout.gap(8);
      return;
    case "image": {
      const image = layout.images.get(String(node.attrs?.src ?? ""));
      const alt = String(node.attrs?.alt ?? "").trim();
      if (!image) {
        layout.text(
          [{ text: alt ? `[${alt}]` : "[Image]", italic: true }],
          { size: bodySize, color: muted },
          x,
          width,
        );
        layout.gap(bodySize * 0.5);
        return;
      }
      const scale = Math.min(1, width / image.width, (pageSize[1] - margin * 2) / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      layout.ensure(drawHeight);
      layout.page.drawImage(image.image, {
        x,
        y: layout.y - drawHeight,
        width: drawWidth,
        height: drawHeight,
      });
      layout.y -= drawHeight;
      layout.gap(bodySize * 0.6);
      return;
    }
    case "mistyEmbed":
      layout.text(
        [{ text: `[${embedPlaceholder(node.attrs)}]`, italic: true }],
        { size: bodySize, color: muted },
        x,
        width,
      );
      layout.gap(bodySize * 0.5);
      return;
    case "table":
      table(layout, node, x, width);
      return;
    default:
      blocks(layout, node.content, x, width);
  }
}

function cellRuns(cell: JSONContent): DocRun[] {
  const runs: DocRun[] = [];
  (cell.content ?? []).forEach((child, index) => {
    if (index > 0) runs.push({ text: "", break: true });
    runs.push(...inlineRuns(child.content));
  });
  return runs;
}

function table(layout: Layout, node: JSONContent, x: number, width: number) {
  const rows = (node.content ?? []).filter((row) => row.type === "tableRow");
  const columns = Math.max(1, ...rows.map((row) => row.content?.length ?? 0));
  const cellWidth = width / columns;
  const pad = 4;
  for (const row of rows) {
    const cells = row.content ?? [];
    const style = (cell: JSONContent): Style => ({ size: 10, bold: cell.type === "tableHeader" });
    const height =
      Math.max(
        10 * lineGap,
        ...cells.map((cell) => layout.measure(cellRuns(cell), style(cell), cellWidth - pad * 2)),
      ) +
      pad * 2;
    layout.ensure(height);
    const top = layout.y;
    cells.forEach((cell, index) => {
      const left = x + index * cellWidth;
      layout.page.drawRectangle({
        x: left,
        y: top - height,
        width: cellWidth,
        height,
        borderColor: rule,
        borderWidth: 0.6,
      });
      layout.y = top - pad;
      layout.text(cellRuns(cell), style(cell), left + pad, cellWidth - pad * 2);
    });
    layout.y = top - height;
  }
  layout.gap(bodySize * 0.6);
}

function collectImages(node: JSONContent, into: Set<string>) {
  if (node.type === "image" && typeof node.attrs?.src === "string") into.add(node.attrs.src);
  for (const child of node.content ?? []) collectImages(child, into);
}

/** A doc as a PDF file. */
export async function notePdfBlob(
  title: string,
  json: JSONContent,
  resolveImage?: ResolveExportImage,
): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title || "Untitled doc");
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  const sources = new Set<string>();
  collectImages(json, sources);
  const images = new Map<string, PlacedImage | null>();
  for (const src of sources) {
    const image = resolveImage ? await resolveImage(src) : null;
    let placed: PlacedImage | null = null;
    if (image) {
      try {
        placed = {
          image: await pdf.embedPng(image.data),
          width: image.width,
          height: image.height,
        };
      } catch {
        placed = null;
      }
    }
    images.set(src, placed);
  }
  const layout = new Layout(pdf, fonts, images);
  if (title && !startsWithTitle(json, title)) {
    layout.text([{ text: title }], { size: 24, bold: true }, margin, contentWidth);
    layout.gap(10);
  }
  blocks(layout, json.content, margin, contentWidth);
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
