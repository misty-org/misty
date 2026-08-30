import type { FigmaBindingContext } from "@/api/integrations/figma";

export interface FigmaCanvasReference {
  bindingId: string;
  fileKey: string;
  title: string;
  version: string;
  thumbnailUrl: string;
  sourceUrl: string;
  provenance: {
    provider: "figma";
    bindingId: string;
    fileKey: string;
  };
}

export function toFigmaCanvasReference(
  bindingId: string,
  context: FigmaBindingContext,
  sourceUrl: string,
): FigmaCanvasReference {
  return {
    bindingId,
    fileKey: bounded(context.file.key, 256),
    title: bounded(context.file.name || "Untitled Figma file", 160),
    version: bounded(context.file.version || "Unknown", 160),
    thumbnailUrl: safeHttpsUrl(context.file.thumbnail_url),
    sourceUrl,
    provenance: { provider: "figma", bindingId, fileKey: bounded(context.file.key, 256) },
  };
}

export function figmaImportKey(reference: FigmaCanvasReference): string {
  return `${reference.bindingId}:${reference.fileKey}:${reference.version}`;
}

function bounded(value: string, limit: number): string {
  return value.trim().slice(0, limit);
}

function safeHttpsUrl(value = ""): string {
  if (!value || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}
