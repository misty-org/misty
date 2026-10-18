import { Fragment } from "react";
import { SkeletonList } from "@/shared/ui";
import { WorkGroup } from "../progress/WorkGroup";
import { StatusRow, StatusTable } from "../progress/StatusTable";
import { checklistForInvocation, checklistSummary, nestChildren } from "./checklists";
import { statusText } from "./ChecklistStatus";
import { useCollaborationStore } from "./store";
import type { AgentChecklist as Checklist, ChecklistItem } from "./types";

/** Why a run's step in progress is not moving: it stopped, or waits on someone. */
export type ChecklistHold = "stopped" | "waiting_for_you" | { device: string } | undefined;

function holdText(hold: ChecklistHold) {
  if (!hold) return undefined;
  if (hold === "stopped") return "Stopped";
  if (hold === "waiting_for_you") return "Waiting for you";
  return `Waiting for ${hold.device}`;
}

const stateOf = {
  pending: "next",
  in_progress: "running",
  done: "done",
  skipped: "skipped",
  blocked: "failed",
} as const;

function ItemRows({
  items,
  hold,
  nested,
  depth = 0,
}: {
  items: ChecklistItem[];
  hold?: string;
  nested?: Map<string, Checklist[]>;
  depth?: number;
}) {
  return (
    <>
      {items.map((item) => {
        const paused = item.status === "in_progress" && hold;
        return (
          <Fragment key={item.id}>
            <StatusRow
              state={paused ? (hold === "Stopped" ? "stopped" : "waiting") : stateOf[item.status]}
              verb={paused ? hold : statusText[item.status]}
              sub={item.note}
              depth={depth}
            >
              {item.title}
            </StatusRow>
            {nested?.get(item.id)?.map((child) => (
              <ItemRows key={child.invocationId} items={child.items} hold={hold} depth={depth + 1} />
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * A run's live checklist, above its progress lines: a one-line summary
 * ("3 of 6 · Editing tests") over a table of the steps, which stays open unless
 * folded. Delegated runs' steps nest under the step that handed them off.
 */
export function AgentChecklist({
  checklist,
  children = [],
  hold,
}: {
  checklist: Checklist;
  children?: Checklist[];
  hold?: ChecklistHold;
}) {
  const label = holdText(hold);
  const running = !label && checklist.items.some((item) => item.status === "in_progress");
  return (
    // Open from the start, as Claude shows its to-do list: what the agent means to do is always in view.
    <WorkGroup summary={checklistSummary(checklist.items)} running={running} openAtStart>
      <StatusTable label="Checklist">
        <ItemRows
          items={checklist.items}
          hold={label}
          nested={nestChildren(checklist.items, children)}
        />
      </StatusTable>
    </WorkGroup>
  );
}

/**
 * The checklist for one assistant message's run, from the conversation's
 * collaboration state. While that state first loads, the running message shows
 * a skeleton; a refresh keeps the current checklist on screen.
 */
export function AgentMessageChecklist(props: {
  conversationId?: string;
  invocationId?: string;
  running: boolean;
  hold?: ChecklistHold;
}) {
  const state = useCollaborationStore((s) =>
    props.conversationId ? s.byConversation[props.conversationId] : undefined,
  );
  if (!props.invocationId) return null;
  if (!state)
    return props.running && props.conversationId ? (
      <SkeletonList label="Checklist" rows={1} lines={1} leading="icon" className="mb-2" />
    ) : null;
  const { checklist, children } = checklistForInvocation(state.checklists, props.invocationId);
  if (!checklist) return null;
  const stopped = !props.running && checklist.items.some((item) => item.status === "in_progress");
  return (
    <AgentChecklist
      checklist={checklist}
      children={children}
      hold={props.hold ?? (stopped ? "stopped" : undefined)}
    />
  );
}
