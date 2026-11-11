import { Columns3 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  ErrorNotification,
  IconButton,
  SegmentedControl,
  Skeleton,
} from "@/shared/ui";
import { currentSpaceKey } from "../engines/enginesApi";
import { errorText, type Multirun, type MultirunLane } from "./multirunApi";
import { laneTitle } from "./multirunLogic";
import { MultirunCompare } from "./MultirunCompare";
import { MultirunStartForm } from "./MultirunStartForm";
import { useMultirunStore } from "./multirunStore";

interface Props {
  /** The agent whose page this is: its own chats open here, another agent's by its address. */
  agentId: string;
  onPage(page: "task"): void;
  onChat(id: string): void;
}

/** A multi-run in the switcher: when it started and the first words of its task. */
function runLabel(run: Multirun) {
  const time = new Date(run.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const words = laneTitle(run.task);
  return `${time} · ${words.length > 22 ? `${words.slice(0, 21)}…` : words}`;
}

/** What the dialog shows: the start form, or one multi-run by its id. */
type View = "start" | string;

function MultirunDialog({ agentId, onPage, onChat, onClose }: Props & { onClose(): void }) {
  const space = currentSpaceKey();
  const runs = useMultirunStore((state) => state.runs[space]);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [, setParams] = useSearchParams();
  useEffect(() => {
    void useMultirunStore
      .getState()
      .load(space)
      .then((read) => setView((now) => now ?? read[0]?.id ?? "start"))
      .catch((reason) => {
        setError(errorText(reason));
        setView("start");
      });
  }, [space]);
  const run = runs?.find((item) => item.id === view);
  // A multi-run that was just discarded leaves for the newest one left, or the start form.
  const shown: View | null =
    view === null || view === "start" || run ? view : (runs?.[0]?.id ?? "start");
  const openChat = (lane: MultirunLane) => {
    onClose();
    onPage("task");
    if (lane.agentId === agentId) onChat(lane.conversationId);
    else setParams({ agent: lane.agentId, conversation: lane.conversationId });
  };
  const wide = shown !== "start";
  const current: Multirun | undefined = runs?.find((item) => item.id === shown);
  return (
    <DialogContent
      aria-describedby={undefined}
      className={
        wide
          ? "h-[calc(100dvh-5rem)] max-w-[min(1560px,calc(100%-3rem))] grid-rows-[auto_minmax(0,1fr)] gap-5"
          : "gap-5"
      }
    >
      <div className="flex items-center gap-4 pr-10">
        <DialogTitle>{shown === "start" ? "New multi-run" : "Multi-run"}</DialogTitle>
        {wide && runs && runs.length > 1 ? (
          <SegmentedControl
            label="Which multi-run"
            size="xs"
            value={shown ?? ""}
            options={runs.slice(0, 4).map((item) => ({ value: item.id, label: runLabel(item) }))}
            onChange={setView}
          />
        ) : null}
      </div>
      {shown === null ? (
        <div className="grid gap-3" aria-hidden="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : shown === "start" ? (
        <MultirunStartForm
          space={space}
          onStarted={(started) => setView(started.id)}
          onCancel={runs?.length ? () => setView(runs[0]?.id ?? "start") : undefined}
        />
      ) : current ? (
        <MultirunCompare
          key={current.id}
          space={space}
          run={current}
          onOpenChat={openChat}
          onNew={() => setView("start")}
          onReview={() => {
            onClose();
            onPage("task");
          }}
        />
      ) : null}
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </DialogContent>
  );
}

/**
 * Multi-run on the Agents page: one task given to several agents at once, each in its own
 * worktree of the Space's folder, then compared side by side so the best can be kept.
 */
export function MultirunButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Multi-run" onClick={() => setOpen(true)}>
        <Columns3 size={16} />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <MultirunDialog {...props} onClose={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}
