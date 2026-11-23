import { lazyTool, ToolSuspense } from "@misty/ui";
import type { LabNoteBodyEditorProps } from "./LabNoteBodyEditor";

const LabNoteBodyEditor = lazyTool(async () => {
  const { LabNoteBodyEditor } = await import("./LabNoteBodyEditor");
  return { default: LabNoteBodyEditor };
});

export function LiveNoteBodyEditor(props: LabNoteBodyEditorProps) {
  return (
    <ToolSuspense tool="note editor" size="inline">
      <LabNoteBodyEditor {...props} />
    </ToolSuspense>
  );
}
