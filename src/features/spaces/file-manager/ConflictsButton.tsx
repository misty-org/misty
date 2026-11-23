import { useCallback, useEffect, useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  IconButton,
  ListRow,
  RowGroupSection,
  RowGroupStack,
} from "@misty/ui";
import {
  openAgentThread,
  threadClashes,
  useThreadWork,
  watchThreadWork,
  type ThreadClashes,
} from "@/features/agents";
import { driveNative, subscribeDriveChanged, type DriveEntry } from "../drive/drive_native";
import { usePane } from "./pane_context";

const lastPart = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

const parentOf = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return `/${parts.slice(0, -1).join("/")}`;
};

export function ConflictsButton() {
  const pane = usePane();
  const [open, setOpen] = useState(false);
  const [copies, setCopies] = useState<DriveEntry[]>([]);
  const [threads, setThreads] = useState<ThreadClashes[]>([]);

  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshNow = useCallback(() => {
    void driveNative.conflicts().then(setCopies, () => setCopies([]));
    void threadClashes().then(setThreads, () => setThreads([]));
  }, []);
  const refresh = useCallback(() => {
    if (waiting.current) return;
    waiting.current = setTimeout(() => {
      waiting.current = null;
      refreshNow();
    }, 750);
  }, [refreshNow]);

  useEffect(() => {
    watchThreadWork();
    refreshNow();
    const subscription = subscribeDriveChanged(() => refresh());
    let states = "";
    const stopThreads = useThreadWork.subscribe((state) => {
      const next = Object.values(state.byConversation)
        .map((view) => (view ? `${view.conversationId}:${view.state}` : ""))
        .join(",");
      if (next !== states) {
        states = next;
        refresh();
      }
    });
    return () => {
      subscription.stop();
      stopThreads();
      if (waiting.current) clearTimeout(waiting.current);
      waiting.current = null;
    };
  }, [refresh, refreshNow]);

  useEffect(() => {
    if (open) refreshNow();
  }, [open, refreshNow]);

  const count = copies.length + threads.reduce((total, thread) => total + thread.clashes.length, 0);
  if (count === 0 && !open) return null;

  return (
    <>
      <IconButton label="Conflicts" onClick={() => setOpen(true)}>
        <FileWarning />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent layout="scroll">
          <DialogHeader>
            <DialogTitle>Conflicts</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <RowGroupStack>
              {threads.length ? (
                <RowGroupSection title="Threads">
                  {threads.map((thread) => (
                    <ListRow
                      key={thread.conversationId}
                      label={lastPart(thread.folder)}
                      description={
                        thread.clashes.length === 1
                          ? `${lastPart(thread.clashes[0]!.path)} clashes`
                          : `${thread.clashes.length} files clash`
                      }
                      onOpen={() => {
                        setOpen(false);
                        openAgentThread(thread.agentId, thread.conversationId);
                      }}
                    />
                  ))}
                </RowGroupSection>
              ) : null}
              {copies.length ? (
                <RowGroupSection title="Conflicted copies">
                  {copies.map((copy) => (
                    <ListRow
                      key={`${copy.space_id}:${copy.id}`}
                      label={copy.name}
                      description={parentOf(copy.path)}
                      onOpen={() => {
                        setOpen(false);
                        pane.store.getState().go({
                          kind: "space-drive",
                          spaceId: copy.space_id,
                          path: parentOf(copy.path),
                        });
                      }}
                    />
                  ))}
                </RowGroupSection>
              ) : null}
            </RowGroupStack>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
