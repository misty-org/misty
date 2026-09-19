import { useAppThemeStore } from "@/features/settings";
import { hydrateDrawingBinaryFile, uploadDrawingBinaryFile } from "../drawingAssets";
import CollaborativeDrawingCanvasView, {
  type CollaborativeDrawingCanvasProps,
} from "./CollaborativeDrawingCanvasView";
export type {
  DrawingAiController,
  DrawingAiPatch,
  DrawingAiSnapshot,
} from "./CollaborativeDrawingCanvasView";
export default function CollaborativeDrawingCanvas(
  props: Omit<CollaborativeDrawingCanvasProps, "runtime">,
) {
  const theme = useAppThemeStore((state) => state.resolvedTheme);
  return (
    <CollaborativeDrawingCanvasView
      {...props}
      runtime={{ theme, upload: uploadDrawingBinaryFile, hydrate: hydrateDrawingBinaryFile }}
    />
  );
}
