import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui";
import { interventionLabels as labels, type AgentInterventionWait as Wait } from "./api";
import { useAgentInterventions } from "./store";

const empty: Wait[] = [];
export function AgentInterventions({
  accountId,
  onCount,
}: {
  accountId: string;
  onCount(count: number): void;
}) {
  const store = useAgentInterventions();
  const matched = store.accountId === accountId;
  const items = matched ? store.items : empty;
  const loading = !matched || (!store.loaded && store.loading);
  const busy = matched ? store.busy : "";
  const error = matched ? store.error : "";
  const [notice, setNotice] = useState("");
  const active = useRef(false);
  const refresh = store.refresh;
  useEffect(() => {
    active.current = true;
    useAgentInterventions.getState().setAccount(accountId);
    void refresh();
    return () => {
      active.current = false;
    };
  }, [accountId, refresh]);
  useEffect(() => {
    onCount(items.filter((item) => Date.parse(item.expiresAt) > Date.now()).length);
  }, [items, onCount]);
  const decide = async (wait: Wait, ready: boolean) => {
    setNotice("");
    const saved = await store.decide(accountId, wait.id, ready);
    if (saved && active.current && useAgentInterventions.getState().accountId === accountId)
      setNotice(
        ready
          ? "Your response was saved. Misty will recheck the original browser before continuing."
          : "Your response was saved. This action will stop.",
      );
  };
  return (
    <section aria-label="Browser requests" className="border-b border-charcoal-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        <h2 className="text-base font-medium text-cream-bright">Browser requests</h2>
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
          Checking for browser requests…
        </p>
      ) : !items.length ? (
        <p className="px-2 text-sm text-cream-muted">No browser requests waiting for you.</p>
      ) : null}
      <ul className="m-0 list-none p-0">
        {items.map((wait) => (
          <li key={wait.id} className="border-t border-charcoal-border/70 px-2 py-3">
            <h3 className="text-sm font-medium text-cream-bright">{labels[wait.action]}</h3>
            <p className="mt-1 break-words text-sm text-cream-muted [overflow-wrap:anywhere]">
              Attached browser: {wait.targetLabel || "Misty browser"}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-cream [overflow-wrap:anywhere]">
              {wait.reason}
            </p>
            <p className="mt-2 text-sm text-cream-muted">
              Complete this in the original browser and check that the intended account is signed
              in. Then continue here.
            </p>
            <p className="mt-1 text-xs text-cream-muted">
              Expires {new Date(wait.expiresAt).toLocaleString()}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                disabled={Boolean(busy) || Date.parse(wait.expiresAt) <= Date.now()}
                onClick={() => void decide(wait, true)}
              >
                {busy === wait.id ? "Saving…" : "I've finished — continue"}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={Boolean(busy)}
                onClick={() => void decide(wait, false)}
              >
                Stop this action
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
