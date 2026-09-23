import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button, SkeletonList } from "@/shared/ui";
import { checklistForInvocation, checklistSummary, nestChildren } from "./checklists";
import { statusText, StepIcon } from "./ChecklistStatus";
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

function ItemRow({
  item,
  hold,
  nested,
}: {
  item: ChecklistItem;
  hold?: string;
  nested?: Checklist[];
}) {
  const status = item.status === "in_progress" && hold ? hold : statusText[item.status];
  return (
    <li role="listitem" data-status={item.status} aria-label={`${item.title}: ${status}`}>
      <span className="agent-plan-check" title={status}>
        <StepIcon status={item.status} paused={Boolean(hold)} />
      </span>
      <div>
        <p>
          <span>{item.title}</span>
          {item.status === "in_progress" && hold ? <small> · {hold}</small> : null}
        </p>
        {item.note && <small>{item.note}</small>}
        {nested?.map((child) => (
          <ChecklistItems key={child.invocationId} items={child.items} hold={hold} />
        ))}
      </div>
    </li>
  );
}

function ChecklistItems(props: {
  items: ChecklistItem[];
  hold?: string;
  nested?: Map<string, Checklist[]>;
}) {
  return (
    <ol role="list">
      {props.items.map((item) => (
        <ItemRow key={item.id} item={item} hold={props.hold} nested={props.nested?.get(item.id)} />
      ))}
    </ol>
  );
}

/**
 * A run's live checklist, above its progress lines: a one-line summary
 * ("3 of 6 · Editing tests") that opens the steps. Delegated runs' steps nest
 * under the step that handed them off. Monochrome icons; status is always text.
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
  const [open, setOpen] = useState(false);
  const label = holdText(hold);
  const summary = checklistSummary(checklist.items, label);
  return (
    <section className="agent-plan-checklist agent-live-checklist" aria-label="Checklist">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 justify-self-start px-1.5 text-xs font-normal text-cream-muted"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown className={open ? "size-3.5" : "size-3.5 -rotate-90"} aria-hidden="true" />
        <span aria-live="polite">{summary}</span>
      </Button>
      {open ? (
        <ChecklistItems
          items={checklist.items}
          hold={label}
          nested={nestChildren(checklist.items, children)}
        />
      ) : null}
    </section>
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
