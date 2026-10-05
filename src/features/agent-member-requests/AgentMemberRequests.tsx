import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui";
import type { AgentMemberRequest } from "./api";
import { useAgentMemberRequests } from "./store";

const empty: AgentMemberRequest[] = [];
const expiry = (createdAt: string) => new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000);

/** Requests other members' agents sent to this account's published agents. */
export function AgentMemberRequests({
  accountId,
  selectedId,
}: {
  accountId: string;
  selectedId?: string;
}) {
  const store = useAgentMemberRequests();
  const matched = store.accountId === accountId;
  const items = matched
    ? store.items.filter((item) => !selectedId || item.id === selectedId)
    : empty;
  const loading = !matched || (!store.loaded && store.loading);
  const busy = matched ? store.busy : "";
  const error = matched ? store.error : "";
  const [notice, setNotice] = useState("");
  const active = useRef(false);
  const refresh = store.refresh;
  useEffect(() => {
    active.current = true;
    useAgentMemberRequests.getState().setAccount(accountId);
    void refresh();
    return () => {
      active.current = false;
    };
  }, [accountId, refresh]);
  const decide = async (request: AgentMemberRequest, approve: boolean) => {
    setNotice("");
    const saved = await store.decide(accountId, request.id, approve);
    if (saved && active.current)
      setNotice(
        approve
          ? `${request.target_agent_name} started. Its reply goes to ${request.requester_name}’s agent and appears in ${request.space_name}.`
          : "Declined. Nothing ran.",
      );
  };
  return (
    <section aria-label="Agent requests" className="border-b border-charcoal-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        <h2 className="text-base font-medium text-cream-bright">Agent requests</h2>
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={loading || Boolean(busy)}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-2 text-sm text-cream">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="px-2 text-sm text-cream-muted">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="px-2 text-sm text-cream-muted">
          Checking for agent requests…
        </p>
      ) : !items.length ? (
        <p className="px-2 text-sm text-cream-muted">No agent requests waiting for you.</p>
      ) : null}
      <ul className="m-0 list-none p-0">
        {items.map((request) => (
          <li key={request.id} className="border-t border-charcoal-border/70 px-2 py-3">
            <h3 className="text-sm font-medium text-cream-bright">
              {request.requester_name || "A member"}’s agent asked {request.target_agent_name}
            </h3>
            <p className="mt-1 text-sm text-cream-muted">In {request.space_name}</p>
            <blockquote className="mt-2 border-l-2 border-charcoal-border pl-3 whitespace-pre-wrap break-words text-sm text-cream [overflow-wrap:anywhere]">
              {request.message}
            </blockquote>
            <p className="mt-2 text-sm text-cream-muted">
              Approving runs {request.target_agent_name} in {request.space_name} with your
              permissions there. You pay for its work.
            </p>
            <p className="mt-1 text-xs text-cream-muted">
              Expires {expiry(request.created_at).toLocaleString()}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                disabled={Boolean(busy)}
                onClick={() => void decide(request, true)}
              >
                {busy === request.id ? "Saving…" : "Approve"}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={Boolean(busy)}
                onClick={() => void decide(request, false)}
              >
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
