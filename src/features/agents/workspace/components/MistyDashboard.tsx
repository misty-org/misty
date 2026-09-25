import { useCallback, useEffect, useState, useRef } from "react";
import {
  runtimeAiApi as ai,
  runtimeAgentsApi as agents,
  useAgentsAuth,
  useAgentsWorkspace,
  openAgentsMisty as openMisty,
} from "../agentsRuntime";
import {
  activityParent,
  type MistyActivityEntry,
} from "@/features/misty/activity";
import type { PersonalAgentRunDetail } from "../model/interfaces/personal";

export function MistyDashboard({
  onManageConnections,
}: {
  onManageConnections: () => void;
}) {
  const { user } = useAgentsAuth();
  const scope = useAgentsWorkspace((s) => s.activeScopeKey);
  const spaceId = scope.startsWith("space:") ? scope.slice(6) : "";
  const identity = useRef("");
  identity.current = `${user?.id}:${spaceId}`;
  const [entries, setEntries] = useState<MistyActivityEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PersonalAgentRunDetail>();
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!user?.id || !spaceId) {
      setLoading(false);
      return;
    }
    try {
      const result = await ai.activity(spaceId);
      if (identity.current !== `${user?.id}:${spaceId}`) return;
      setEntries(result.entries);
      setError("");
    } catch (reason) {
      if (identity.current === `${user?.id}:${spaceId}`)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (identity.current === `${user?.id}:${spaceId}`) setLoading(false);
    }
  }, [spaceId, user?.id]);
  useEffect(() => {
    setLoading(true);
    setError("");
    setEntries([]);
    setDetail(undefined);
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const action = async (run: () => Promise<unknown>) => {
    const requestIdentity = identity.current;
    setBusy(true);
    try {
      await run();
      if (identity.current !== requestIdentity) return;
      setDetail(undefined);
      await refresh();
    } catch (reason) {
      if (identity.current === requestIdentity) setError(String(reason));
    } finally {
      if (identity.current === requestIdentity) setBusy(false);
    }
  };
  return (
    <main className="flex h-full min-h-0 flex-col bg-charcoal-bg text-cream">
      <header className="flex flex-wrap items-center gap-3 border-b border-charcoal-border p-4">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Misty activity</h1>
          <p className="text-sm text-cream-muted">
            Your private tasks, delegated work, and approvals.
          </p>
        </div>
        <button
          className="rounded-md border border-charcoal-border px-3 py-2 text-sm"
          onClick={onManageConnections}
        >
          Connections
        </button>
        <button
          className="rounded-md bg-charcoal-active px-3 py-2 text-sm"
          onClick={() =>
            void openMisty({ spaceId }).catch((reason) =>
              setError(String(reason)),
            )
          }
        >
          Open Misty
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && (
          <p role="alert">
            {error}{" "}
            <button className="underline" onClick={() => void refresh()}>
              Retry
            </button>
          </p>
        )}
        {loading ? (
          <p role="status">Loading activity…</p>
        ) : !entries.length ? (
          <p className="text-sm text-cream-muted">
            No activity yet. Open Misty to start a task in this Space.
          </p>
        ) : null}
        {entries.map((entry) => (
          <section
            key={entry.id}
            className="border-b border-charcoal-border py-4"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {entry.parent_run_id && (
                  <p className="text-xs text-cream-muted">
                    Delegated by{" "}
                    {activityParent(entry, entries)?.title || "Misty"} · depth{" "}
                    {entry.delegation_depth}
                  </p>
                )}
                <h2 className="text-sm font-medium">{entry.title}</h2>
                <p className="mt-1 text-xs text-cream-muted">
                  {entry.state.replace(/_/g, " ")} ·{" "}
                  {new Date(entry.updated_at).toLocaleString()}
                </p>
              </div>
              {entry.conversation_id && (
                <button
                  className="text-xs underline"
                  onClick={() =>
                    void openMisty({
                      spaceId,
                      conversationId: entry.conversation_id,
                    }).catch((reason) => setError(String(reason)))
                  }
                >
                  Conversation
                </button>
              )}
              {entry.run_id && (
                <button
                  className="text-xs underline"
                  onClick={() =>
                    void agents
                      .run<PersonalAgentRunDetail>(entry.run_id)
                      .then((value) => {
                        if (identity.current === `${user?.id}:${spaceId}`)
                          setDetail(value);
                      })
                      .catch((reason) => setError(String(reason)))
                  }
                >
                  Details
                </button>
              )}
              {![
                "completed",
                "failed",
                "canceled",
                "completed_with_errors",
              ].includes(entry.state) && (
                <button
                  disabled={busy}
                  className="text-xs underline"
                  onClick={() =>
                    void action(() =>
                      entry.kind === "invocation"
                        ? ai.cancelInvocation(entry.id)
                        : agents.cancelRun(entry.run_id),
                    )
                  }
                >
                  Cancel
                </button>
              )}
            </div>
            {entry.result && entry.result !== "{}" && (
              <details className="mt-2 text-xs">
                <summary>Result</summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                  {entry.result}
                </pre>
              </details>
            )}
            {entry.events.length > 0 && (
              <details className="mt-2 text-xs text-cream-muted">
                <summary>Tool activity</summary>
                <ul className="mt-2 space-y-1">
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
          </section>
        ))}
        {detail && (
          <section className="mt-4 rounded-lg border border-charcoal-border p-4">
            <h2 className="font-medium">Run details</h2>
            <p className="mt-2 text-sm">{detail.instruction}</p>
            {detail.approvals
              .filter((a) => a.state === "pending")
              .map((approval) => (
                <div key={approval.id} className="mt-3">
                  <p>{approval.summary}</p>
                  {(["approve", "deny"] as const).map((decision) => (
                    <button
                      key={decision}
                      disabled={busy}
                      className="mr-3 underline"
                      onClick={() =>
                        void action(() =>
                          agents.decideApproval(
                            detail.summary.run_id,
                            approval.id,
                            decision,
                          ),
                        )
                      }
                    >
                      {decision === "approve" ? "Approve" : "Deny"}
                    </button>
                  ))}
                </div>
              ))}
            <pre className="mt-3 whitespace-pre-wrap text-xs">
              {JSON.stringify(detail.result, null, 2)}
            </pre>
            <button
              className="mt-2 text-xs underline"
              onClick={() => setDetail(undefined)}
            >
              Close details
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
