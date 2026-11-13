import { useMemo } from "react";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import { MistyFilePicker, readFileFromPath } from "@/features/files";
import { useAiSurfaceActions, useAiSurfaceAdapter, type AiSurfaceAdapter } from "@/features/agents";
import { NoteAiSelectionMenuView } from "./NoteAiSelectionMenuView";
import { useNoteCollaborationRoom } from "../hooks/useNoteCollaborationRoom";
import { uploadNoteAsset, resolveNoteAssetUrl } from "../noteAssets";
import {
  NoteBlockEditorView,
  type NoteBlockEditorProps,
  type NoteEditorRuntime,
  type NoteAiSelection,
} from "./NoteBlockEditorView";

const hostNoteEditorRuntime: NoteEditorRuntime = {
  useCollaborationRoom(spaceId, noteId) {
    const room = useNoteCollaborationRoom(spaceId, noteId);
    const session = useMemo(
      () => (room.session ? { ...room.session, role: room.session.ticket.role } : null),
      [room.session],
    );
    return { ...room, session };
  },
  uploadAsset: uploadNoteAsset,
  resolveAsset: async (reference) => ({ url: await resolveNoteAssetUrl(reference), release() {} }),
  renderImagePicker: ({ onCancel, onSelect }) => (
    <MistyFilePicker
      mode="file"
      title="Insert image into doc"
      allowedExtensions={["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "ico"]}
      onCancel={onCancel}
      onSelect={(path) => {
        void readFileFromPath(path)
          .then(onSelect)
          .catch(() => undefined);
      }}
    />
  ),
  renderAiRegistration: (adapter) => <NoteAiRegistration adapter={adapter} />,
  renderAiSelection: (adapter, selection) => (
    <NoteAiSelectionMenu adapter={adapter} selection={selection} />
  ),
  renderError: (error, _spaceId, noteId) => (
    <SystemErrorNotice
      error={error}
      scope={`notes:collaboration:${noteId}`}
      title="Doc collaboration is unavailable"
    />
  ),
  reportError: () => undefined,
  openCitation: (citation) => {
    window.dispatchEvent(new CustomEvent("misty:open-ai-citation", { detail: citation }));
  },
};
export function NoteBlockEditor(props: Omit<NoteBlockEditorProps, "runtime">) {
  return <NoteBlockEditorView {...props} runtime={hostNoteEditorRuntime} />;
}
export default NoteBlockEditor;

function NoteAiRegistration({ adapter }: { adapter: AiSurfaceAdapter | null }) {
  useAiSurfaceAdapter(adapter);
  return null;
}

function NoteAiSelectionMenu({
  adapter,
  selection,
}: {
  adapter: AiSurfaceAdapter | null;
  selection: NoteAiSelection;
}) {
  const actions = useAiSurfaceActions(adapter);
  const proposal = actions.proposal;
  const replacement =
    proposal?.kind === "text_patch"
      ? (proposal.operations as { replacement?: unknown })?.replacement
      : undefined;
  return (
    <NoteAiSelectionMenuView
      selection={selection}
      snapshot={{
        available: Boolean(adapter && actions.available),
        ...(proposal
          ? {
              proposal: {
                id: proposal.id,
                kind: proposal.kind,
                state: proposal.state,
                stale: actions.proposalStale,
                ...(typeof replacement === "string" ? { replacement } : {}),
              },
            }
          : {}),
      }}
      runAction={actions.runAction}
      decideProposal={actions.decideProposal}
    />
  );
}
