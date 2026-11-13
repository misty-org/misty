import { Pencil } from "lucide-react";
import { IconButton } from "@/shared/ui";
import { AiSelectionMenu } from "@/features/agents";
import type { AiSuggestedAction, AiCompanionAnchor } from "@/features/agents";
import type { MistyAiControlsSnapshot } from "@/shared/schemas";
import { noteSelectionActions, type NoteAiSelection } from "./NoteBlockEditorView";

export function NoteAiSelectionMenuView({
  snapshot,
  selection,
  runAction,
  reportError = () => {},
}: {
  snapshot: MistyAiControlsSnapshot;
  reportError?(error: unknown): void;
  selection: NoteAiSelection;
  runAction(action: AiSuggestedAction, anchor?: AiCompanionAnchor): Promise<void>;
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
          <IconButton variant="secondary" label="Edit selection with Misty">
            <Pencil />
          </IconButton>
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
