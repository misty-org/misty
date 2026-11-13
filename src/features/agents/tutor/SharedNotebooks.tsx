import { BookOpen, Download, ExternalLink, Share2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/features/account/core";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, ListRow, MenuItem, SectionHeading, useNotice } from "@/shared/ui";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import {
  NOTEBOOK_DOC_PREFIX,
  saveSharedNotebook,
  shareNotebook,
  stopSharingNotebook,
} from "./notebookShare";
import { useTutorStore } from "./tutorStore";
import type { Notebook } from "./tutorTypes";

const docHref = (spaceId: string, docId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/notes?note=${encodeURIComponent(docId)}`;

/**
 * Sharing a notebook with the window's Space, asking first and saying who will see it; null when
 * the window has no Space to share with. The notebook's bar and its ⋯ menu both share through it.
 */
export function useNotebookShare(
  notebook: Notebook,
  onError: (message: string) => void,
): { spaceName: string; share(): Promise<void> } | null {
  const space = spacesGateway.maybe()?.windowSpace();
  if (!space) return null;
  return {
    spaceName: space.name,
    share: async () => {
      const asked =
        `Share “${notebook.title}” with ${space.name}? Everyone in it can read its sources, ` +
        "overview and notes, and the shared copy stays up to date as you add to it.";
      if (!(await confirmAction(asked, "Share notebook"))) return;
      try {
        await shareNotebook(notebook.id);
      } catch (error) {
        onError(error instanceof Error ? error.message : "The notebook couldn't be shared.");
      }
    },
  };
}

/**
 * A notebook's sharing rows for its ⋯ menu: share it with the window's Space, or, once shared,
 * open its doc there or stop sharing. Sharing asks first, saying who will see it.
 */
export function NotebookShareItems({
  notebook,
  onError,
}: {
  notebook: Notebook;
  onError(message: string): void;
}) {
  const navigate = useNavigate();
  const sharing = useNotebookShare(notebook, onError);
  const shared = notebook.shared;
  if (shared) {
    return (
      <>
        <MenuItem
          icon={ExternalLink}
          label={`Open in ${shared.spaceName}`}
          onSelect={() => navigate(docHref(shared.spaceId, shared.docId))}
        />
        <MenuItem
          icon={Unlink}
          label="Stop sharing"
          onSelect={() =>
            void confirmStopSharing(notebook).then((ok) => ok && stopSharingNotebook(notebook.id))
          }
        />
      </>
    );
  }
  if (!sharing) return null;
  return (
    <MenuItem
      icon={Share2}
      label={`Share with ${sharing.spaceName}`}
      onSelect={() => void sharing.share()}
    />
  );
}

type SharedDoc = { id: string; title: string; spaceId: string };

/**
 * Notebooks other people shared into the window's Space, to read in the Space or save into this
 * Lab and keep learning from with the person's own AI. Shows nothing until there are some.
 */
export function SharedNotebooks({ onOpen }: { onOpen(notebookId: string): void }) {
  const navigate = useNavigate();
  const me = useUserStore((state) => state.me?.id);
  const notebooks = useTutorStore((state) => state.notebooks);
  const [docs, setDocs] = useState<SharedDoc[]>([]);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const space = spacesGateway.maybe()?.windowSpace();
  const spaceId = space?.id;

  useEffect(() => {
    if (!spaceId || !me) return;
    let live = true;
    spacesGateway
      .get()
      .listDocs(spaceId)
      .then((all) => {
        if (!live) return;
        setDocs(
          all
            .filter((doc) => doc.creatorId !== me && doc.title.startsWith(NOTEBOOK_DOC_PREFIX))
            .map((doc) => ({
              id: doc.id,
              title: doc.title.slice(NOTEBOOK_DOC_PREFIX.length),
              spaceId,
            })),
        );
      })
      // A Space that can't be read here shows no shared notebooks.
      .catch(() => live && setDocs([]));
    return () => {
      live = false;
    };
  }, [spaceId, me]);

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  const saved = new Map(
    Object.values(notebooks)
      .filter((notebook) => notebook.savedFrom)
      .map((notebook) => [notebook.savedFrom!.docId, notebook.id]),
  );
  if (!docs.length || !space) return null;

  const save = async (doc: SharedDoc) => {
    setSaving(doc.id);
    try {
      onOpen(await saveSharedNotebook(doc.spaceId, doc.id, doc.title));
    } catch {
      setError(`Couldn't save “${doc.title}” to your Lab. Try again.`);
    } finally {
      setSaving("");
    }
  };

  return (
    <section aria-label={`Shared in ${space.name}`} className="grid gap-1">
      <SectionHeading title={`Shared in ${space.name}`} count={docs.length} />
      {docs.map((doc) => {
        const mine = saved.get(doc.id);
        return (
          <ListRow
            key={doc.id}
            label={doc.title}
            leading={BookOpen}
            onOpen={() => (mine ? onOpen(mine) : navigate(docHref(doc.spaceId, doc.id)))}
            trailing={
              mine ? null : (
                <Button
                  size="sm"
                  icon={Download}
                  loading={saving === doc.id}
                  disabled={Boolean(saving)}
                  onClick={() => void save(doc)}
                >
                  Save to my Lab
                </Button>
              )
            }
          />
        );
      })}
    </section>
  );
}

/** Asks before stopping, since friends keep the last copy but stop seeing updates. */
async function confirmStopSharing(notebook: Notebook) {
  return confirmAction(
    `Stop sharing “${notebook.title}”? The copy in ${notebook.shared?.spaceName ?? "the Space"} stays as it is now.`,
    "Stop sharing",
  );
}
