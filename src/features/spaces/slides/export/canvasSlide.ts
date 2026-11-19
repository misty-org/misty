import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  footerBox,
  footerFontSize,
  layoutSpec,
  type SlotBox,
  type TextSlotSpec,
} from "../deck/layouts";
import { richTextIsEmpty } from "../deck/richText";
import type { SlideSnapshot } from "../deck/snapshot";
import type { DeckTheme, ThemeColors, ThemeFont } from "../deck/themes";
import type { RichBlock, RichRun } from "../deck/types";
import { loadImage, type ExportChartData } from "./exportShared";
import type { PptxSources } from "./pptx";

/**
 * Draws one slide onto a 1920×1080 canvas from its layout and theme, the way the renderer lays
 * it out: the same boxes, the same fitted sizes and the theme's own fonts (loaded before this
 * runs). The PDF export pages these.
 */
export async function drawSlide(
  canvas: HTMLCanvasElement,
  slide: SlideSnapshot,
  number: number,
  deckTitle: string,
  theme: DeckTheme,
  colors: ThemeColors,
  sources: PptxSources,
): Promise<void> {
  canvas.width = SLIDE_WIDTH;
  canvas.height = SLIDE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This computer couldn't draw the slide.");
  context.fillStyle = colors.background;
  context.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
  context.textBaseline = "alphabetic";
  const layout = layoutSpec(slide.layout);
  for (const spec of layout.slots) {
    if (spec.kind === "visual") {
      if (!slide.visual) continue;
      await drawVisual(
        context,
        spec.box,
        slide,
        theme,
        colors,
        sources,
        spec.bleed ? 0 : theme.spacing.radius,
      );
      continue;
    }
    const blocks = slide.texts[spec.name] ?? [];
    if (richTextIsEmpty(blocks)) continue;
    const fit = sources.fit(theme, spec, blocks);
    drawText(context, spec, blocks, theme, colors, fit.size);
  }
  if (layout.footer) {
    context.font = font(theme.body, 400, false, footerFontSize);
    context.fillStyle = colors.soft;
    const baseline = footerBox.y + footerBox.h - footerFontSize * 0.25;
    context.textAlign = "left";
    context.fillText(deckTitle, footerBox.x, baseline, footerBox.w * 0.8);
    context.textAlign = "right";
    context.fillText(String(number), footerBox.x + footerBox.w, baseline);
    context.textAlign = "left";
  }
}

function font(face: ThemeFont, weight: number, italic: boolean, size: number): string {
  return `${italic ? "italic " : ""}${weight} ${size}px "${face.css}", ${face.fallback}`;
}

interface Piece {
  text: string;
  run: RichRun;
  width: number;
}

interface Line {
  pieces: Piece[];
  width: number;
  bullet: boolean;
  level: number;
  /** The first line of a block, which carries the gap above it. */
  first: boolean;
}

function drawText(
  context: CanvasRenderingContext2D,
  spec: TextSlotSpec,
  blocks: RichBlock[],
  theme: DeckTheme,
  colors: ThemeColors,
  size: number,
) {
  const face = spec.font === "heading" ? theme.heading : theme.body;
  const baseWeight =
    spec.font === "heading" ? Math.max(spec.weight, theme.headingWeight) : spec.weight;
  const tracking = spec.tracking ? `${spec.tracking * size}px` : "0px";
  const withSpacing = context as CanvasRenderingContext2D & { letterSpacing?: string };
  const lines: Line[] = [];
  const indent = size * 1.15;

  for (const block of blocks) {
    const level = block.kind === "bullet" ? block.level : 0;
    const left = block.kind === "bullet" ? indent * (level + 1) : 0;
    const limit = spec.box.w - left;
    let line: Line = { pieces: [], width: 0, bullet: block.kind === "bullet", level, first: true };
    const push = () => {
      lines.push(line);
      line = { pieces: [], width: 0, bullet: false, level, first: false };
    };
    for (const run of block.runs) {
      context.font = font(
        face,
        run.bold ? Math.max(700, baseWeight) : baseWeight,
        Boolean(run.italic),
        size,
      );
      if ("letterSpacing" in withSpacing) withSpacing.letterSpacing = tracking;
      for (const word of run.text.split(/(\s+)/)) {
        if (!word) continue;
        const width = context.measureText(word).width;
        if (line.width + width > limit && line.pieces.length && word.trim()) push();
        if (!line.pieces.length && !word.trim()) continue;
        line.pieces.push({ text: word, run, width });
        line.width += width;
      }
    }
    push();
  }

  const lineHeight = size * spec.lineHeight;
  const gap = (line: Line, index: number) =>
    index === 0 || !line.first
      ? 0
      : (line.bullet ? theme.spacing.bullet : theme.spacing.paragraph) * size;
  const total = lines.reduce((sum, line, index) => sum + lineHeight + gap(line, index), 0);
  let y =
    spec.valign === "end"
      ? spec.box.y + spec.box.h - total
      : spec.valign === "center"
        ? spec.box.y + (spec.box.h - total) / 2
        : spec.box.y;

  context.save();
  context.beginPath();
  context.rect(spec.box.x, spec.box.y, spec.box.w, spec.box.h);
  context.clip();
  lines.forEach((line, index) => {
    y += gap(line, index);
    const inset = isBulletLine(lines, index) ? indent * (line.level + 1) : 0;
    let x =
      spec.align === "center" ? spec.box.x + (spec.box.w - line.width) / 2 : spec.box.x + inset;
    const baseline = y + lineHeight * 0.5 + size * 0.35;
    if (line.bullet) {
      context.fillStyle = colors.accent;
      context.beginPath();
      context.arc(
        spec.box.x + inset - indent * 0.55,
        baseline - size * 0.32,
        size * 0.14,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    for (const piece of line.pieces) {
      context.font = font(
        face,
        piece.run.bold ? Math.max(700, baseWeight) : baseWeight,
        Boolean(piece.run.italic),
        size,
      );
      if ("letterSpacing" in withSpacing) withSpacing.letterSpacing = tracking;
      context.fillStyle = colors[spec.color];
      context.fillText(piece.text, x, baseline);
      if (piece.run.href)
        context.fillRect(x, baseline + size * 0.1, piece.width, Math.max(2, size * 0.05));
      x += piece.width;
    }
    y += lineHeight;
  });
  context.restore();
  if ("letterSpacing" in withSpacing) withSpacing.letterSpacing = "0px";
}

/** Whether a line belongs to a bullet (its first line, or one it wrapped onto). */
function isBulletLine(lines: Line[], index: number): boolean {
  for (let at = index; at >= 0; at -= 1) {
    if (lines[at].first) return lines[at].bullet;
  }
  return false;
}

async function drawVisual(
  context: CanvasRenderingContext2D,
  box: SlotBox,
  slide: SlideSnapshot,
  theme: DeckTheme,
  colors: ThemeColors,
  sources: PptxSources,
  radius: number,
) {
  const embed = slide.visual!;
  context.save();
  context.beginPath();
  context.roundRect(box.x, box.y, box.w, box.h, radius);
  context.clip();
  try {
    if (embed.type === "image") {
      const focal = { x: embed.focal_x ?? 0.5, y: embed.focal_y ?? 0.5 };
      const data = await sources.image(embed.asset_id, box, focal);
      if (data) context.drawImage(await loadImage(data), box.x, box.y, box.w, box.h);
      return;
    }
    if (embed.type === "board-frame") {
      const frame = await sources.frame(embed);
      if (frame) {
        const image = await loadImage(frame.data);
        const scale = Math.min(box.w / image.width, box.h / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        context.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
        return;
      }
    }
    if (embed.type === "data-chart") {
      const chart = await sources.chart(embed);
      if (chart && drawChart(context, box, chart, theme, colors)) return;
    }
    context.strokeStyle = colors.line;
    context.lineWidth = 3;
    context.strokeRect(box.x + 1.5, box.y + 1.5, box.w - 3, box.h - 3);
    context.fillStyle = colors.soft;
    context.font = font(theme.body, 400, false, 40);
    context.textAlign = "center";
    context.fillText(embed.title, box.x + box.w / 2, box.y + box.h / 2, box.w - 96);
    context.textAlign = "left";
  } finally {
    context.restore();
  }
}

/** A Data chart drawn plainly in the deck's series colors. False when its type can't be drawn. */
export function drawChart(
  context: CanvasRenderingContext2D,
  box: SlotBox,
  chart: ExportChartData,
  theme: DeckTheme,
  colors: ThemeColors,
): boolean {
  const pad = 48;
  const label = 24;
  const area = {
    x: box.x + pad + 56,
    y: box.y + pad,
    w: box.w - pad * 2 - 56,
    h: box.h - pad * 2 - label * 2,
  };
  context.font = font(theme.body, 400, false, label);
  if (chart.type === "stat") {
    context.fillStyle = colors.accent;
    context.font = font(theme.heading, theme.headingWeight, false, 160);
    context.textAlign = "center";
    context.fillText(
      chart.display ?? "",
      box.x + box.w / 2,
      box.y + box.h / 2 + 56,
      box.w - pad * 2,
    );
    context.textAlign = "left";
    return true;
  }
  const series = chart.series.filter((entry) => entry.values.length);
  if (!series.length) return false;
  const all = series.flatMap((entry) => entry.values.map((value) => value ?? 0));
  if (chart.type === "pie" || chart.type === "donut") {
    const values = series[0].values.map((value) => Math.max(0, value ?? 0));
    const sum = values.reduce((total, value) => total + value, 0) || 1;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const r = Math.min(box.w, box.h) / 2 - pad;
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const next = angle + (value / sum) * Math.PI * 2;
      context.fillStyle = theme.series[index % theme.series.length];
      context.beginPath();
      context.moveTo(cx, cy);
      context.arc(cx, cy, r, angle, next);
      context.closePath();
      context.fill();
      angle = next;
    });
    if (chart.type === "donut") {
      context.fillStyle = colors.background;
      context.beginPath();
      context.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
      context.fill();
    }
    return true;
  }
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const yOf = (value: number) => area.y + area.h - ((value - min) / span) * area.h;
  context.strokeStyle = colors.line;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(area.x, yOf(0));
  context.lineTo(area.x + area.w, yOf(0));
  context.stroke();
  context.fillStyle = colors.soft;
  context.textAlign = "right";
  context.fillText(formatNumber(max), area.x - 12, area.y + label * 0.4);
  context.fillText(formatNumber(min), area.x - 12, area.y + area.h);
  const count = Math.max(...series.map((entry) => entry.values.length));
  const step = area.w / Math.max(1, count);
  context.textAlign = "center";
  const every = Math.max(1, Math.ceil(count / 12));
  for (let index = 0; index < count; index += every)
    context.fillText(
      chart.categories[index] ?? "",
      area.x + step * (index + 0.5),
      area.y + area.h + label * 1.4,
      step * every,
    );
  context.textAlign = "left";
  if (chart.type === "bar" || chart.type === "column") {
    const width = (step * 0.7) / series.length;
    series.forEach((entry, s) => {
      context.fillStyle = theme.series[s % theme.series.length];
      entry.values.forEach((value, index) => {
        const v = value ?? 0;
        const x = area.x + step * index + step * 0.15 + width * s;
        const top = yOf(Math.max(0, v));
        context.fillRect(x, top, width, Math.abs(yOf(v) - yOf(0)) || 1);
      });
    });
    return true;
  }
  series.forEach((entry, s) => {
    const color = theme.series[s % theme.series.length];
    const points = entry.values.map(
      (value, index) => [area.x + step * (index + 0.5), yOf(value ?? 0)] as const,
    );
    if (chart.type === "scatter") {
      context.fillStyle = color;
      for (const [x, y] of points) {
        context.beginPath();
        context.arc(x, y, 8, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }
    context.strokeStyle = color;
    context.lineWidth = 6;
    context.lineJoin = "round";
    context.beginPath();
    points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
    context.stroke();
    if (chart.type === "area" && points.length) {
      context.globalAlpha = 0.25;
      context.fillStyle = color;
      context.lineTo(points[points.length - 1][0], yOf(0));
      context.lineTo(points[0][0], yOf(0));
      context.closePath();
      context.fill();
      context.globalAlpha = 1;
    }
  });
  return true;
}

function formatNumber(value: number): string {
  return Math.abs(value) >= 1000
    ? new Intl.NumberFormat(undefined, { notation: "compact" }).format(value)
    : String(Math.round(value * 100) / 100);
}
