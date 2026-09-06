import { useState } from "react";
import { Check, X, RotateCcw, Pencil } from "lucide-react";
import { Button } from "@/shared/ui";
import { AiSelectionMenu } from "@/features/ai-surface/AiSelectionMenu";
import type { AiSuggestedAction, AiCompanionAnchor } from "@/features/ai-surface/types";
import type { MistyAiControlsSnapshot } from "@misty/sdk";
import {
  noteSelectionActions,
  type NoteAiSelection,
  type NotesInlineProposal,
} from "./NoteBlockEditorView";

export function NoteAiSelectionMenuView({
  snapshot,
  selection,
  runAction,
  decideProposal,
  reportError = () => {},
}: {
  snapshot: MistyAiControlsSnapshot;
  reportError?(error: unknown): void;
  selection: NoteAiSelection;
  runAction(action: AiSuggestedAction, anchor?: AiCompanionAnchor): Promise<void>;
  decideProposal(decision: "accept" | "reject" | "refine"): Promise<void>;
}) {
  const followEnabled = snapshot.following;
  const [lastAction, setLastAction] = useState<AiSuggestedAction>(noteSelectionActions[0]);
  const proposal = snapshot.proposal?.kind === "text_patch" ? snapshot.proposal : undefined;
  const replacement = proposal?.replacement;
  const inlineProposal: NotesInlineProposal | undefined =
    proposal && typeof replacement === "string"
      ? {
          selection: selection.snapshot,
          replacement,
          artifactId: proposal.id,
          status: proposal?.stale
            ? "stale"
            : proposal.state === "rejected"
              ? "discarded"
              : proposal.state,
        }
      : undefined;
  if (!snapshot.available || (!followEnabled && !proposal)) return null;
  return (
    <div
      className="fixed z-[80]"
      style={{ left: selection.x, top: selection.y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {inlineProposal ? (
        <div className="w-[min(440px,calc(100vw-24px))] rounded-xl border border-charcoal-border bg-charcoal-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-cream">
            <span>Misty inline edit</span>
            <span className="text-[10px] text-cream-muted">
              {inlineProposal.status === "stale" ? "Selection changed" : "Review before applying"}
            </span>
          </div>
          <div className="max-h-36 space-y-2 overflow-y-auto text-xs leading-relaxed">
            <p className="rounded-md bg-red-950/20 px-2 py-1.5 text-cream-muted line-through">
              {selection.snapshot.content}
            </p>
            <p className="rounded-md bg-emerald-950/25 px-2 py-1.5 text-cream">
              {inlineProposal.replacement}
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={proposal?.stale}
              onClick={() => void decideProposal("accept").catch(reportError)}
            >
              <Check className="size-3.5" /> Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => void decideProposal("reject").catch(reportError)}
            >
              <X className="size-3.5" /> Discard
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() =>
                void decideProposal("reject")
                  .then(() => runAction(lastAction))
                  .catch(reportError)
              }
            >
              <RotateCcw className="size-3.5" /> Retry
            </Button>
          </div>
        </div>
      ) : (
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
            setLastAction(action);
            void runAction(action, {
              kind: "selection",
              paneId: "",
              x: selection.x,
              y: selection.y,
            }).catch(reportError);
          }}
        />
      )}
    </div>
  );
}
