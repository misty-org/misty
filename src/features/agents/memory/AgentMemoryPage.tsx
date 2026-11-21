import { useCallback, useEffect, useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogTitle,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  ListRowSkeleton,
  Text,
} from "@misty/ui";
import { agentMemoryApi, type AgentMemoryNote, type AgentMemoryNotes } from "./agentMemoryApi";

/** A read-only view over the notes this agent's engine has saved on this computer. */
export function AgentMemoryPage(props: {
  accountId: string;
  agentId: string;
  agentName: string;
  engine?: string;
  conversationId?: string;
}) {
  const [result, setResult] = useState<AgentMemoryNotes>({ notes: [], errors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<AgentMemoryNote>();
  const [deleting, setDeleting] = useState<AgentMemoryNote>();
  const [deleteError, setDeleteError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await agentMemoryApi.list(
        props.accountId,
        props.agentId,
        props.engine ?? "",
        props.conversationId,
      );
      setResult(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The agent's memory couldn't be read.");
    } finally {
      setLoading(false);
    }
  }, [props.accountId, props.agentId, props.engine, props.conversationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = async () => {
    if (!deleting) return;
    const note = deleting;
    setDeleting(undefined);
    setDeleteError("");
    try {
      await agentMemoryApi.delete(
        props.accountId,
        props.agentId,
        props.engine ?? "",
        props.conversationId,
        note.id,
      );
      setResult((current) => ({
        ...current,
        notes: current.notes.filter((item) => item.id !== note.id),
      }));
      if (opened?.id === note.id) setOpened(undefined);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "The memory note couldn't be deleted.");
    }
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label={`${props.agentName} memory`}>
      {loading ? <ListRowSkeleton label="Agent memory" rows={7} lines={2} /> : null}
      {!loading && error ? (
        <ErrorState
          title="Couldn't read this agent's memory"
          line={error}
          action={{ label: "Try again", icon: RotateCw, onClick: () => void reload() }}
        />
      ) : null}
      {!loading && !error && !result.notes.length && result.errors.length ? (
        <ErrorState
          title="Couldn't read this agent's memory"
          line={result.errors.join(" ")}
          action={{ label: "Try again", icon: RotateCw, onClick: () => void reload() }}
        />
      ) : null}
      {!loading && !error && !result.notes.length && !result.errors.length ? (
        <EmptyState
          title="No saved notes"
          line="Notes this agent's engine saves will appear here."
        />
      ) : null}
      {!loading && !error && result.notes.length ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {result.errors.length ? (
            <Text as="p" role="alert" tone="failed" size="caption" className="px-2 pb-2">
              {result.errors.join(" ")}
            </Text>
          ) : null}
          <div className="grid">
            {result.notes.map((note) => (
              <ListRow
                key={note.id}
                label={note.title}
                description={note.source}
                onOpen={() => setOpened(note)}
                trailing={
                  note.deletable ? (
                    <IconButton
                      label={`Delete ${note.title}`}
                      variant="quiet"
                      onClick={() => {
                        setDeleteError("");
                        setDeleting(note);
                      }}
                    >
                      <Trash2 />
                    </IconButton>
                  ) : null
                }
              />
            ))}
          </div>
        </div>
      ) : null}
      {deleteError ? (
        <Text as="p" role="alert" tone="failed" size="caption" className="px-5 pb-3">
          {deleteError}
        </Text>
      ) : null}
      <Dialog open={Boolean(opened)} onOpenChange={(open) => !open && setOpened(undefined)}>
        <DialogContent size="lg" layout="scroll" aria-describedby={undefined}>
          <DialogTitle>{opened?.title}</DialogTitle>
          <Text as="div" size="body" wrap className="mt-4 min-h-0 whitespace-pre-wrap">
            {opened?.content}
          </Text>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory note?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete “{deleting?.title}” from {deleting?.source}? The note will be removed from the
              engine's own memory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
