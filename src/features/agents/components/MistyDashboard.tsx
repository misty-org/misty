import { observeAccountChanges } from "@/api/accountEvents";
import { activityParent, type MistyActivityEntry } from "@/features/misty/activity";
import { Button } from "@/shared/ui";
import {
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  Clock,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { runtimeAiApi as ai, runtimeAgentsApi as agents, useAgentsAuth } from "../AgentsRuntime";
import type { PersonalAgentRunDetail } from "../model/interfaces/personal";

const finishedStates = new Set(["completed", "failed", "canceled", "completed_with_errors"]);
const stateLabels: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
  completed_with_errors: "Completed with errors",
  awaiting_approval: "Needs approval",
  awaiting_device: "Waiting for device",
  awaiting_intervention: "Needs attention",
};

export function MistyDashboard({
  agentId,
  spaceId = "",
  onScheduled,
}: {
  agentId?: string;
  spaceId?: string;
  onScheduled?(): void;
}) {
  const { user } = useAgentsAuth();
  const identity = useRef("");
  identity.current = `${user?.id}:${spaceId}:${agentId}`;
  const [entries, setEntries] = useState<MistyActivityEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string>();
  const refresh = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    const requestIdentity = `${user.id}:${spaceId}:${agentId}`;
    try {
      const result = await ai.activity(spaceId, agentId);
      if (identity.current !== requestIdentity) return;
      setEntries(result.entries);
      setError("");
    } catch (reason) {
      if (identity.current === requestIdentity)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (identity.current === requestIdentity) setLoading(false);
    }
  }, [spaceId, user?.id, agentId]);
  useEffect(() => {
    setLoading(true);
    setError("");
    setEntries([]);
    setExpandedId(undefined);
    return observeAccountChanges(user?.id ?? "", ["runs", "invocations"], refresh);
  }, [refresh, user?.id]);
  return (
    <section className="agent-activity" aria-label="Agent activity">
      {error && (
        <div className="agent-activity-error" role="alert">
          <p>{error}</p>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      )}
      {loading ? (
        <p className="agents-list-note" role="status">
          Loading activity…
        </p>
      ) : !entries.length && !error ? (
        <p className="agents-list-note">No activity yet.</p>
      ) : null}
      {entries.map((entry) => (
        <ActivityItem
          key={`${user?.id}:${spaceId}:${agentId}:${entry.id}`}
          entry={entry}
          parentTitle={entry.parent_run_id ? activityParent(entry, entries)?.title : undefined}
          expanded={expandedId === entry.id}
          onToggle={() => setExpandedId(expandedId === entry.id ? undefined : entry.id)}
          onChanged={refresh}
        />
      ))}
      {onScheduled && (
        <Button
          variant="ghost"
          size="sm"
          className="agent-activity-scheduled"
          onClick={onScheduled}
        >
          <CalendarClock size={16} />
          Scheduled
        </Button>
      )}
    </section>
  );
}

function ActivityItem({
  entry,
  parentTitle,
  expanded,
  onToggle,
  onChanged,
}: {
  entry: MistyActivityEntry;
  parentTitle?: string;
  expanded: boolean;
  onToggle(): void;
  onChanged(): Promise<void>;
}) {
  const detailsId = useId();
  const StatusIcon =
    entry.state === "completed"
      ? Check
      : entry.state === "canceled"
        ? X
        : entry.state === "queued"
          ? Clock
          : entry.state === "running"
            ? CircleDashed
            : CircleAlert;
  const updated = new Date(entry.updated_at);
  return (
    <section className="agent-activity-item">
      <Button
        variant="ghost"
        justify="start"
        className="agent-activity-row"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <StatusIcon size={16} aria-hidden="true" />
        <span>
          <strong>{entry.title || "Agent task"}</strong>
          <small>
            {stateLabels[entry.state] || entry.state.replace(/_/g, " ")}
            {Number.isFinite(updated.getTime()) && (
              <>
                {" "}
                ·{" "}
                <time dateTime={updated.toISOString()}>
                  {updated.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </>
            )}
          </small>
        </span>
        <ChevronDown size={16} className="agent-activity-chevron" aria-hidden="true" />
      </Button>
      {expanded && (
        <div id={detailsId} className="agent-activity-details">
          <ActivityDetails entry={entry} parentTitle={parentTitle} onChanged={onChanged} />
        </div>
      )}
    </section>
  );
}

function resultText(result: string | Record<string, unknown> | undefined) {
  if (!result || result === "{}") return "";
  let value: unknown = result;
  if (typeof result === "string") {
    try {
      value = JSON.parse(result);
    } catch {
      return result;
    }
  }
  if (value && typeof value === "object") {
    for (const key of ["summary", "text", "message", "answer", "output"]) {
      const text = (value as Record<string, unknown>)[key];
      if (typeof text === "string") return text;
    }
    if (!Object.keys(value).length) return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function ActivityDetails({
  entry,
  parentTitle,
  onChanged,
}: {
  entry: MistyActivityEntry;
  parentTitle?: string;
  onChanged(): Promise<void>;
}) {
  const [detail, setDetail] = useState<PersonalAgentRunDetail>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(entry.run_id));
  const [busy, setBusy] = useState(false);
  const live = useRef(false);
  const loadDetail = useCallback(async () => {
    if (!entry.run_id) return;
    setLoading(true);
    try {
      const value = await agents.run<PersonalAgentRunDetail>(entry.run_id);
      if (live.current) {
        setDetail(value);
        setError("");
      }
    } catch (reason) {
      if (live.current) setError(String(reason));
    } finally {
      if (live.current) setLoading(false);
    }
  }, [entry.run_id]);
  useEffect(() => {
    live.current = true;
    void loadDetail();
    return () => {
      live.current = false;
    };
  }, [loadDetail]);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      if (!live.current) return;
      await onChanged();
      if (live.current) await loadDetail();
    } catch (reason) {
      if (live.current) setError(String(reason));
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const result = resultText(detail?.result ?? entry.result);
  return (
    <>
      {parentTitle && <p className="text-cream-muted">Delegated by {parentTitle}</p>}
      {loading && <p role="status">Loading task details…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {entry.run_id && (
            <Button variant="ghost" size="sm" onClick={() => void loadDetail()}>
              Retry details
            </Button>
          )}
        </div>
      )}
      {detail?.instruction && <p>{detail.instruction}</p>}
      {detail?.approvals
        .filter((approval) => approval.state === "pending")
        .map((approval) => (
          <div key={approval.id} className="agent-activity-approval">
            <p>{approval.summary}</p>
            <div>
              {(["approve", "deny"] as const).map((decision) => (
                <Button
                  key={decision}
                  variant={decision === "approve" ? "secondary" : "ghost"}
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void action(() => agents.decideApproval(entry.run_id, approval.id, decision))
                  }
                >
                  {decision === "approve" ? "Approve" : "Deny"}
                </Button>
              ))}
            </div>
          </div>
        ))}
      {result && <p className="agent-activity-result">{result}</p>}
      {entry.events.length > 0 && (
        <details className="agent-activity-events">
          <summary>Tool activity</summary>
          <ul>
            {entry.events.map((event, index) => (
              <li key={index}>
                {event.text ||
                  event.error ||
                  event.toolName ||
                  event.tool_name ||
                  event.phase ||
                  event.type}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!loading && !error && !detail?.instruction && !result && !entry.events.length && (
        <p className="text-cream-muted">No details available.</p>
      )}
      {!finishedStates.has(entry.state) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void action(() =>
              entry.kind === "invocation"
                ? ai.cancelInvocation(entry.id)
                : agents.cancelRun(entry.run_id),
            )
          }
        >
          {busy ? "Canceling…" : "Cancel"}
        </Button>
      )}
    </>
  );
}
