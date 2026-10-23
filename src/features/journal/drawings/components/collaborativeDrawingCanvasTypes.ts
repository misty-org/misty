import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { DrawingSession } from "../drawingRuntime";
import type { DrawingAssetReference, SpaceDrawing } from "../types";

interface DrawingCanvasRuntime {
  theme: "light" | "dark";
  openLink?(url: string): Promise<void>;
  upload(space: string, drawing: string, file: BinaryFileData): Promise<DrawingAssetReference>;
  hydrate(
    space: string,
    drawing: string,
    reference: DrawingAssetReference,
  ): Promise<BinaryFileData>;
}

export interface CollaborativeDrawingCanvasProps {
  runtime: DrawingCanvasRuntime;
  drawing: SpaceDrawing;
  session: DrawingSession;
  onAiSnapshot?: (snapshot: DrawingAiSnapshot) => void;
  onAiController?: (controller: DrawingAiController | null) => void;
}

export interface DrawingAiSnapshot {
  content: string;
  contentHash: string;
  selectedCount: number;
  elementCount: number;
}

export interface DrawingAiPatch {
  base_hash?: string;
  changes?: Array<{
    op?: string;
    element_id?: string;
    element?: { x?: number; y?: number };
  }>;
}

export interface DrawingAiController {
  canApply: (patch: DrawingAiPatch) => boolean;
  apply: (patch: DrawingAiPatch) => void;
}
