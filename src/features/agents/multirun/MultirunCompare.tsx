import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AgentProfile } from "@/shared/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  ErrorNotification,
  Notification,
} from "@/shared/ui";
import { useContextPanel } from "../context-panel/contextPanelStore";
import { folderName } from "../engines/enginesApi";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { errorText, type Multirun, type MultirunLane } from "./multirunApi";
import { MultirunLaneCard } from "./MultirunLaneCard";
import { stopLane } from "./multirunRuns";
import { useMultirunStore } from "./multirunStore";
import "./multirun.css";

const agentOf = (agents: readonly AgentProfile[], id: string) =>
  agents.find((agent) => agent.id === id);

/**
 * A multi-run side by side: one column per agent with its state, its answer and its changes
 * against where they all started. One lane can be kept, which stages its changes in the linked
 * folder; discarding removes every lane's worktree and branch.
 */
export function MultirunCompare({
  space,
  run,
  onOpenChat,
  onNew,
  onReview,
}: {
  space: string;
  run: Multirun;
  onOpenChat(lane: MultirunLane): void;
  onNew(): void;
  /** Leaves for the folder's changes, after a lane was kept. */
  onReview(): void;
}) {
  const agents = usePersonalAgentsStore((state) => state.agents);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [kept, setKept] = useState(0);
  const [error, setError] = useState("");
  const act = (work: Promise<unknown>) => {
    setBusy(true);
    return work.catch((reason) => setError(errorText(reason))).finally(() => setBusy(false));
  };
  const keep = (lane: MultirunLane) =>
    void act(
      useMultirunStore
        .getState()
        .keep(space, run.id, lane.index)
        .then(() => setKept((count) => count + 1)),
    );
  const discard = () =>
    void act(
      Promise.all(run.lanes.map(stopLane)).then(() =>
        useMultirunStore.getState().discard(space, run.id),
      ),
    );
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-5">
      <header className="flex items-start gap-4 pr-10">
        <p
          className="line-clamp-2 min-w-0 flex-1 whitespace-pre-line text-sm text-cream"
          title={run.task}
        >
          {run.task}
        </p>
        <span className="flex-none pt-1 text-xs text-cream-muted" title={run.folder}>
          {folderName(run.folder)}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={onNew}>
          <Plus size={14} />
          New multi-run
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={14} />
          Discard all
        </Button>
      </header>
      <div className="multirun-lanes">
        {run.lanes.map((lane) => (
          <MultirunLaneCard
            key={lane.index}
            run={run}
            lane={lane}
            agent={agentOf(agents, lane.agentId)}
            busy={busy}
            onOpenChat={() => onOpenChat(lane)}
            onKeep={() => keep(lane)}
            onStop={() => void stopLane(lane)}
          />
        ))}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Discard this multi-run?</AlertDialogTitle>
          <AlertDialogDescription>
            Every agent&apos;s copy of the folder and its branch are removed, and any agent still
            working is stopped. Their chats stay, and so does what you kept.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={discard}>Discard all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Notification key={kept} active={kept > 0} tone="success">
        <span className="grid gap-2">
          Its changes are staged in {folderName(run.folder)}, not committed.
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => {
              useContextPanel.getState().show("changes");
              onReview();
            }}
          >
            Review changes
          </Button>
        </span>
      </Notification>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </div>
  );
}
