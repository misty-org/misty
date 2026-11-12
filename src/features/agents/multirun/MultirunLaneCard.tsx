import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleStop,
  Hand,
  MessageSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import { Button, Skeleton, Spinner } from "@/shared/ui";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { AgentAvatar } from "../personal/AgentAvatar";
import type { Multirun, MultirunLane } from "./multirunApi";
import { isLaneSettled, laneStatus, laneStatusLabels, type LaneStatus } from "./multirunLogic";
import { laneReply } from "./multirunRuns";
import { MultirunChanges, useLaneChanges } from "./MultirunChanges";

const statusIcons: Record<Exclude<LaneStatus, "working">, LucideIcon> = {
  waiting: Hand,
  finished: CircleCheck,
  failed: CircleAlert,
  stopped: CircleStop,
  missing: CircleDashed,
};

function Status({ status }: { status: LaneStatus }) {
  const Icon = status === "working" ? null : statusIcons[status];
  return (
    <span className="multirun-status" data-status={status}>
      {Icon ? <Icon size={14} aria-hidden="true" /> : <Spinner size="sm" label={false} />}
      {laneStatusLabels[status]}
    </span>
  );
}

/**
 * One agent's lane: who it is and how it stands, what it answered, and what it changed in its
 * own copy of the folder. Its chat opens from here, and its changes can be kept.
 */
export function MultirunLaneCard({
  run,
  lane,
  agent,
  busy,
  onOpenChat,
  onKeep,
  onStop,
}: {
  run: Multirun;
  lane: MultirunLane;
  agent: AgentProfile | undefined;
  /** Something is being kept or discarded, so nothing else can start. */
  busy: boolean;
  onOpenChat(): void;
  onKeep(): void;
  onStop(): void;
}) {
  const reply = useMistyStore((state) => laneReply(state.conversations, lane.conversationId));
  const status = laneStatus(reply);
  // A tool that ran or a lane that ended is when its files may have changed.
  const { files, error } = useLaneChanges(
    run.id,
    lane.index,
    `${reply?.progress?.length}:${status}`,
  );
  const answer = reply?.content.trim() ?? "";
  const settled = isLaneSettled(status);
  return (
    <article className="multirun-lane" data-kept={lane.kept} aria-label={agent?.name ?? "Agent"}>
      <header className="multirun-lane-head">
        <AgentAvatar agent={agent} compact />
        <span className="multirun-lane-name">{agent?.name ?? "Removed agent"}</span>
        <Status status={status} />
      </header>
      <div className="multirun-answer" data-muted={!answer}>
        {answer ? (
          answer
        ) : settled ? (
          status === "missing" ? (
            "This lane's chat was deleted."
          ) : (
            "No answer."
          )
        ) : (
          <span className="grid gap-2" aria-hidden="true">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </span>
        )}
      </div>
      <MultirunChanges files={files} error={error} />
      <footer className="multirun-lane-foot">
        <Button type="button" disabled={status === "missing"} onClick={onOpenChat}>
          <MessageSquare size={14} />
          Open chat
        </Button>
        {settled ? null : (
          <Button type="button" variant="quiet" onClick={onStop}>
            Stop
          </Button>
        )}
        {lane.kept ? (
          <span className="multirun-kept">
            <Check size={14} aria-hidden="true" />
            Kept
          </span>
        ) : (
          <Button
            type="button"
            className="ml-auto"
            disabled={busy || !settled || !files?.length}
            onClick={onKeep}
          >
            Keep this one
          </Button>
        )}
      </footer>
    </article>
  );
}
