import type PptxGenJS from "pptxgenjs";
import type { FitResult } from "../deck/fit";
import {
  SLIDE_WIDTH,
  footerBox,
  footerFontSize,
  layoutSpec,
  type SlotBox,
  type TextSlotSpec,
} from "../deck/layouts";
import { createOffscreenMeasurer } from "../deck/lint";
import { richTextIsEmpty } from "../deck/richText";
import type { DeckTheme, ThemeColors } from "../deck/themes";
import type { LiveEmbedRef, RichBlock, SlotEmbed } from "../deck/types";
import {
  blobToDataUrl,
  boardFramePng,
  croppedImage,
  deckFilename,
  loadChartData,
  loadImage,
  prepareDeck,
  saveBlob,
  type DeckExportInput,
  type ExportChartData,
} from "./exportShared";

/**
 * PowerPoint export. Every layout maps onto a 13.333×7.5 in slide by the same boxes the
 * renderer uses (1920 frame pixels = 13.333 in, so 144 px an inch and 1 px = 0.5 pt). Text
 * becomes real, editable text boxes in the theme's fonts, Data charts become native charts with
 * their data, Whiteboard frames become pictures, and notes become speaker notes.
 */

export const PPTX_WIDTH_IN = 13.333;
export const PPTX_HEIGHT_IN = 7.5;
const PX_PER_IN = SLIDE_WIDTH / PPTX_WIDTH_IN;
const PT_PER_PX = 0.5;

/** What the export reads from outside the deck, swappable for tests. */
export interface PptxSources {
  fit(theme: DeckTheme, spec: TextSlotSpec, blocks: RichBlock[]): FitResult;
  image(assetId: string, box: SlotBox, focal: { x: number; y: number }): Promise<string | null>;
  chart(embed: LiveEmbedRef): Promise<ExportChartData | null>;
  frame(embed: LiveEmbedRef): Promise<{ data: string; width: number; height: number } | null>;
  dispose?(): void;
}

type Pptx = InstanceType<typeof PptxGenJS>;
type PptxSlide = ReturnType<Pptx["addSlide"]>;
type TextRun = { text: string; options?: PptxGenJS.TextPropsOptions };

/** The deck as a .pptx file. */
export async function exportDeckPptx(
  input: DeckExportInput,
  sources: PptxSources = defaultSources(input),
): Promise<Blob> {
  const { snapshot, theme, colors } = await prepareDeck(input);
  const { default: PptxGen } = await import("pptxgenjs");
  const pptx: Pptx = new PptxGen();
  pptx.defineLayout({ name: "MISTY_16x9", width: PPTX_WIDTH_IN, height: PPTX_HEIGHT_IN });
  pptx.layout = "MISTY_16x9";
  pptx.title = input.title;
  pptx.company = "Misty";
  try {
    for (const [index, slide] of snapshot.slides.entries()) {
      const page = pptx.addSlide();
      page.background = { color: hex(colors.background) };
      if (slide.hidden) page.hidden = true;
      const layout = layoutSpec(slide.layout);
      for (const spec of layout.slots) {
        if (spec.kind === "visual") {
          if (slide.visual) await addVisual(page, spec.box, slide.visual, theme, colors, sources);
          continue;
        }
        const blocks = slide.texts[spec.name] ?? [];
        if (richTextIsEmpty(blocks)) continue;
        const fit = sources.fit(theme, spec, blocks);
        page.addText(textRuns(blocks), textOptions(spec, theme, colors, fit.size));
      }
      if (layout.footer) addFooter(page, input.title, index + 1, theme, colors);
      if (slide.notes.trim()) page.addNotes(slide.notes);
    }
  } finally {
    sources.dispose?.();
  }
  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  return blob;
}

/** Exports the deck and saves it as `<title>.pptx`. */
export async function downloadDeckPptx(input: DeckExportInput): Promise<void> {
  saveBlob(await exportDeckPptx(input), deckFilename(input.title, "pptx"));
}

export function defaultSources(input: DeckExportInput): PptxSources {
  const measurer = createOffscreenMeasurer();
  return {
    fit: measurer.fit,
    image: (assetId, box, focal) => croppedImage(input, assetId, box, focal),
    chart: (embed) => loadChartData(input.spaceId, embed),
    frame: async (embed) => {
      const blob = await boardFramePng(input.spaceId, embed);
      if (!blob) return null;
      const data = await blobToDataUrl(blob);
      const image = await loadImage(data);
      return { data, width: image.width, height: image.height };
    },
    dispose: measurer.dispose,
  };
}

// ------------------------------------------------------------------------------------------
// The mapping.

export function inches(box: SlotBox) {
  return {
    x: round(box.x / PX_PER_IN),
    y: round(box.y / PX_PER_IN),
    w: round(box.w / PX_PER_IN),
    h: round(box.h / PX_PER_IN),
  };
}

export function points(px: number): number {
  return Math.round(px * PT_PER_PX * 10) / 10;
}

/** A slot's blocks as pptxgenjs text runs: one paragraph per block, bullets with their level. */
export function textRuns(blocks: RichBlock[]): TextRun[] {
  const runs: TextRun[] = [];
  blocks.forEach((block, index) => {
    const last = index === blocks.length - 1;
    const parts = block.runs.length ? block.runs : [{ text: "" }];
    parts.forEach((run, part) => {
      const options: Record<string, unknown> = {};
      if (run.bold) options.bold = true;
      if (run.italic) options.italic = true;
      if (run.href) options.hyperlink = { url: run.href };
      if (part === 0 && block.kind === "bullet") {
        options.bullet = true;
        options.indentLevel = block.level;
      }
      if (part === parts.length - 1 && !last) options.breakLine = true;
      runs.push(
        Object.keys(options).length
          ? { text: run.text, options: options as PptxGenJS.TextPropsOptions }
          : { text: run.text },
      );
    });
  });
  return runs;
}

export function textOptions(
  spec: TextSlotSpec,
  theme: DeckTheme,
  colors: ThemeColors,
  sizePx: number,
) {
  const font = spec.font === "heading" ? theme.heading : theme.body;
  const weight = spec.font === "heading" ? Math.max(spec.weight, theme.headingWeight) : spec.weight;
  const fontSize = points(sizePx);
  return {
    ...inches(spec.box),
    fontFace: font.office,
    fontSize,
    bold: weight >= 600,
    color: hex(colors[spec.color]),
    align: spec.align === "center" ? ("center" as const) : ("left" as const),
    valign:
      spec.valign === "end"
        ? ("bottom" as const)
        : spec.valign === "center"
          ? ("middle" as const)
          : ("top" as const),
    margin: 0,
    // PowerPoint's single spacing is about 1.2 lines.
    lineSpacingMultiple: round(spec.lineHeight / 1.2),
    paraSpaceAfter: Math.round(fontSize * theme.spacing.paragraph),
    ...(spec.tracking ? { charSpacing: round(fontSize * spec.tracking) } : {}),
    fit: "shrink" as const,
    isTextBox: true,
  };
}

function addFooter(
  page: PptxSlide,
  title: string,
  number: number,
  theme: DeckTheme,
  colors: ThemeColors,
) {
  const box = inches(footerBox);
  const base = {
    y: box.y,
    h: box.h,
    fontFace: theme.body.office,
    fontSize: points(footerFontSize),
    color: hex(colors.soft),
    margin: 0,
    valign: "bottom" as const,
  };
  page.addText(title, { ...base, x: box.x, w: round(box.w * 0.8), align: "left" });
  page.addText(String(number), {
    ...base,
    x: round(box.x + box.w * 0.8),
    w: round(box.w * 0.2),
    align: "right",
  });
}

async function addVisual(
  page: PptxSlide,
  box: SlotBox,
  embed: SlotEmbed,
  theme: DeckTheme,
  colors: ThemeColors,
  sources: PptxSources,
) {
  const at = inches(box);
  if (embed.type === "image") {
    const data = await sources.image(embed.asset_id, box, {
      x: embed.focal_x ?? 0.5,
      y: embed.focal_y ?? 0.5,
    });
    if (data) page.addImage({ data, ...at });
    return;
  }
  if (embed.type === "data-chart") {
    const chart = await sources.chart(embed);
    if (chart && addChart(page, at, chart, theme, colors)) return;
  }
  if (embed.type === "board-frame") {
    const frame = await sources.frame(embed);
    if (frame) {
      page.addImage({ data: frame.data, ...contain(at, frame.width, frame.height) });
      return;
    }
  }
  // A range, or a part that couldn't be read: its name where it would be.
  page.addText(embed.title || "Live part", {
    ...at,
    fontFace: theme.body.office,
    fontSize: 20,
    color: hex(colors.soft),
    align: "center",
    valign: "middle",
    line: { color: hex(colors.line), width: 1.5 },
  });
}

const chartTypes: Record<string, { type: string; barDir?: "bar" | "col" }> = {
  bar: { type: "bar", barDir: "bar" },
  column: { type: "bar", barDir: "col" },
  line: { type: "line" },
  area: { type: "area" },
  pie: { type: "pie" },
  donut: { type: "doughnut" },
  scatter: { type: "scatter" },
};

/** A Data chart as a native PowerPoint chart; false when its type has no native form. */
export function addChart(
  page: PptxSlide,
  at: ReturnType<typeof inches>,
  chart: ExportChartData,
  theme: DeckTheme,
  colors: ThemeColors,
): boolean {
  if (chart.type === "stat") {
    page.addText(chart.display ?? "", {
      ...at,
      fontFace: theme.heading.office,
      fontSize: 72,
      bold: true,
      color: hex(colors.accent),
      align: "center",
      valign: "middle",
    });
    return true;
  }
  const mapping = chartTypes[chart.type];
  if (!mapping || !chart.series.length) return false;
  const values = (list: Array<number | null>) => list.map((value) => value ?? 0);
  const data =
    mapping.type === "scatter"
      ? [
          {
            name: "X",
            values: chart.categories.map((category, index) => {
              const number = Number(category);
              return Number.isFinite(number) ? number : index + 1;
            }),
          },
          ...chart.series.map((series) => ({ name: series.name, values: values(series.values) })),
        ]
      : chart.series.map((series) => ({
          name: series.name,
          labels: chart.categories,
          values: values(series.values),
        }));
  const circular = mapping.type === "pie" || mapping.type === "doughnut";
  page.addChart(mapping.type as never, data as never, {
    ...at,
    ...(mapping.barDir ? { barDir: mapping.barDir } : {}),
    chartColors: theme.series.map(hex),
    showLegend: circular || chart.series.length > 1,
    legendPos: "b" as const,
    legendColor: hex(colors.soft),
    legendFontFace: theme.body.office,
    showTitle: Boolean(chart.title),
    title: chart.title,
    titleColor: hex(colors.text),
    titleFontFace: theme.heading.office,
    catAxisLabelColor: hex(colors.soft),
    valAxisLabelColor: hex(colors.soft),
    catAxisLabelFontFace: theme.body.office,
    valAxisLabelFontFace: theme.body.office,
    valGridLine: { color: hex(colors.line), size: 1 },
    ...(mapping.type === "doughnut" ? { holeSize: 60 } : {}),
  });
  return true;
}

function contain(at: ReturnType<typeof inches>, width: number, height: number) {
  if (!width || !height) return at;
  const scale = Math.min(at.w / width, at.h / height);
  const w = round(width * scale);
  const h = round(height * scale);
  return { x: round(at.x + (at.w - w) / 2), y: round(at.y + (at.h - h) / 2), w, h };
}

/** A CSS hex color as pptxgenjs takes it: six digits, no #. */
export function hex(color: string): string {
  const value = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value))
    return value
      .split("")
      .map((digit) => digit + digit)
      .join("")
      .toUpperCase();
  return /^[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : "888888";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
