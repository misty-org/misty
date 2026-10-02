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

export function figmaImportKey(reference: FigmaCanvasReference): string {
  return `${reference.bindingId}:${reference.fileKey}:${reference.version}`;
}
