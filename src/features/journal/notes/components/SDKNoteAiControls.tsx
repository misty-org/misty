import { useEffect, useState } from "react";
import type { MistyAppSDK, MistyAiControlsSnapshot } from "@misty/sdk";
import type { NoteAiSelection } from "./NoteBlockEditorView";
import { NoteAiSelectionMenuView } from "./NoteAiSelectionMenuView";

export function SDKNoteAiControls({
  misty,
  selection,
  report,
}: {
  misty: MistyAppSDK;
  selection: NoteAiSelection;
  report(error: unknown): void;
}) {
  const [snapshot, setSnapshot] = useState<MistyAiControlsSnapshot>({
    available: false,
    following: false,
  });
  useEffect(() => {
    let closed = false,
      remove: (() => void) | undefined;
    void misty.ai
      .subscribe((value) => {
        if (!closed) setSnapshot(value);
      })
      .then((cleanup) => {
        if (closed) cleanup();
        else remove = cleanup;
      })
      .catch(report);
    return () => {
      closed = true;
      remove?.();
    };
  }, [misty, report]);
  useEffect(() => {
    let closed = false;
    void misty.ai
      .snapshot()
      .then((value) => {
        if (!closed) setSnapshot(value);
      })
      .catch(report);
    return () => {
      closed = true;
    };
  }, [misty, selection.snapshot.contentHash, report]);
  return (
    <NoteAiSelectionMenuView
      snapshot={snapshot}
      selection={selection}
      reportError={report}
      runAction={(action) => misty.ai.runAction(action.id, selection.snapshot.contentHash)}
      decideProposal={(decision) =>
        snapshot.proposal
          ? misty.ai.decideProposal(snapshot.proposal.id, decision)
          : Promise.resolve()
      }
    />
  );
}
