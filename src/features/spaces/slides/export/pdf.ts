import { drawSlide } from "./canvasSlide";
import { deckFilename, prepareDeck, saveBlob, type DeckExportInput } from "./exportShared";
import { defaultSources, PPTX_HEIGHT_IN, PPTX_WIDTH_IN, type PptxSources } from "./pptx";

/**
 * PDF export: each shown slide drawn at 1920×1080 and placed on its own 13.333×7.5 in page with
 * pdf-lib. Hidden slides are left out, as when presenting.
 */
export async function exportDeckPdf(
  input: DeckExportInput,
  sources: PptxSources = defaultSources(input),
): Promise<Blob> {
  const { snapshot, theme, colors } = await prepareDeck(input);
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setCreator("Misty");
  const width = PPTX_WIDTH_IN * 72;
  const height = PPTX_HEIGHT_IN * 72;
  const canvas = document.createElement("canvas");
  try {
    for (const [index, slide] of snapshot.slides.entries()) {
      if (slide.hidden) continue;
      await drawSlide(canvas, slide, index + 1, input.title, theme, colors, sources);
      const png = await canvasPng(canvas);
      const image = await pdf.embedPng(png);
      const page = pdf.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
    }
  } finally {
    sources.dispose?.();
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/** Exports the deck and saves it as `<title>.pdf`. */
export async function downloadDeckPdf(input: DeckExportInput): Promise<void> {
  saveBlob(await exportDeckPdf(input), deckFilename(input.title, "pdf"));
}

function canvasPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("The slide couldn't be drawn."));
      else void blob.arrayBuffer().then(resolve, reject);
    }, "image/png");
  });
}
