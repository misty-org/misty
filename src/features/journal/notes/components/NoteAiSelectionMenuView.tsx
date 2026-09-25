import { Pencil } from "lucide-react";
import { Button } from "@/shared/ui";
import { AiSelectionMenu } from "@/features/ai-surface/AiSelectionMenu";
import type {
  AiSuggestedAction,
  AiCompanionAnchor,
} from "@/features/ai-surface/types";
import type { MistyAiControlsSnapshot } from "@misty/sdk";
import {
  noteSelectionActions,
  type NoteAiSelection,
} from "./NoteBlockEditorView";

export function NoteAiSelectionMenuView({
  snapshot,
  selection,
  runAction,
  reportError = () => {},
}: {
  snapshot: MistyAiControlsSnapshot;
  reportError?(error: unknown): void;
  selection: NoteAiSelection;
  runAction(
    action: AiSuggestedAction,
    anchor?: AiCompanionAnchor,
  ): Promise<void>;
  decideProposal(decision: "accept" | "reject" | "refine"): Promise<void>;
}) {
  if (!snapshot.available) return null;
  return (
    <div
      className="fixed z-[80]"
      style={{ left: selection.x, top: selection.y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <AiSelectionMenu
        actions={noteSelectionActions}
        trigger={
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="size-7 rounded-full"
            aria-label="Edit selection with Misty"
          >
            <Pencil className="size-3.5" />
          </Button>
        }
        onAction={(action) => {
          void runAction(action, {
            kind: "selection",
            paneId: "",
            x: selection.x,
            y: selection.y,
          }).catch(reportError);
        }}
      />
    </div>
  );
}
