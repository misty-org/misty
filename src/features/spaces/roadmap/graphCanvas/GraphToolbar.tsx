import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui";
import { ClipboardPaste, Copy, CopyPlus, Maximize2, Redo2, Trash2, Undo2 } from "lucide-react";
import { useRoadmapShortcutTitle as useShortcutTitle } from "../spaceRoadmap/roadmapRuntime";

export function GraphToolbar(props: {
  canEdit: boolean;
  hasSelection: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFit: () => void;
}) {
  const undoTitle = useShortcutTitle("Undo", "roadmap.undo");
  const redoTitle = useShortcutTitle("Redo", "roadmap.redo");
  const copyTitle = useShortcutTitle("Copy", "roadmap.copy");
  const pasteTitle = useShortcutTitle("Paste", "roadmap.paste");
  const duplicateTitle = useShortcutTitle("Duplicate", "roadmap.duplicate");
  const deleteTitle = useShortcutTitle("Delete", "roadmap.delete");
  const tools = [
    { label: undoTitle, icon: Undo2, action: props.onUndo, disabled: !props.canEdit },
    { label: redoTitle, icon: Redo2, action: props.onRedo, disabled: !props.canEdit },
    { label: copyTitle, icon: Copy, action: props.onCopy, disabled: !props.hasSelection },
    {
      label: pasteTitle,
      icon: ClipboardPaste,
      action: props.onPaste,
      disabled: !props.canEdit,
    },
    {
      label: duplicateTitle,
      icon: CopyPlus,
      action: props.onDuplicate,
      disabled: !props.canEdit || !props.hasSelection,
    },
    {
      label: deleteTitle,
      icon: Trash2,
      action: props.onDelete,
      disabled: !props.canEdit || !props.hasSelection,
    },
    { label: "Fit view", icon: Maximize2, action: props.onFit, disabled: false },
  ];
  return (
    <TooltipProvider delayDuration={350}>
      <div
        className="absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-charcoal-border/70 bg-charcoal-bg p-1 shadow-sm "
        aria-label="Canvas editing tools"
      >
        {tools.map(({ label, icon: Icon, action, disabled }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={disabled}
                aria-label={label}
                onClick={action}
              >
                <Icon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
