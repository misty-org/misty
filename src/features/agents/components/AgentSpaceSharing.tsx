import { spacesApi } from "@/api/spaces/api";
import { agentMemberRequestsApi, type AcceptPolicy } from "@/features/agent-member-requests/api";
import { OptionSelect } from "@/shared/ui";
import { useCallback, useEffect, useState } from "react";

type Row = { spaceId: string; spaceName: string; policy: AcceptPolicy };

const options = [
  { value: "off", label: "Off" },
  { value: "ask", label: "Ask me first" },
  { value: "auto", label: "Start right away" },
];

/**
 * Publishes this agent to shared Spaces so other members' agents can ask it
 * for work. The agent acts only in that Space, and the owner pays for it.
 */
export function AgentSpaceSharing({ agentId }: { agentId: string }) {
  const [rows, setRows] = useState<Row[]>();
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const snapshot = await spacesApi.snapshot();
    const shared = snapshot.spaces.filter((space) => space.is_shared || space.member_count > 1);
    return Promise.all(
      shared.map(async (space): Promise<Row> => {
        const { listings } = await agentMemberRequestsApi.listings(space.id);
        const mine = listings.find((listing) => listing.agent_id === agentId);
        return { spaceId: space.id, spaceName: space.name, policy: mine?.accept_policy ?? "off" };
      }),
    );
  }, [agentId]);
  useEffect(() => {
    let live = true;
    setRows(undefined);
    load()
      .then((next) => live && setRows(next))
      .catch(() => live && setError("Shared Spaces couldn’t load."));
    return () => {
      live = false;
    };
  }, [load]);
  const change = async (row: Row, policy: AcceptPolicy) => {
    setSaving(row.spaceId);
    setError("");
    try {
      if (policy === "off") await agentMemberRequestsApi.unpublish(row.spaceId, agentId);
      else await agentMemberRequestsApi.publish(row.spaceId, agentId, policy);
      setRows((current) =>
        current?.map((item) => (item.spaceId === row.spaceId ? { ...item, policy } : item)),
      );
    } catch {
      setError(`Sharing in ${row.spaceName} couldn’t be saved.`);
    } finally {
      setSaving("");
    }
  };
  return (
    <section aria-label="Shared Spaces" className="border-t border-charcoal-border pt-5">
      <h3 className="mb-1 text-sm font-medium">Shared Spaces</h3>
      <p className="mb-3 text-xs text-cream-muted">
        Members’ agents in these Spaces can ask this agent for help. It works only in that Space
        with your permissions there, and you pay for its work.
      </p>
      {!rows && !error ? (
        <p role="status" className="text-xs text-cream-muted">
          Loading Spaces…
        </p>
      ) : null}
      {rows && !rows.length ? (
        <p className="text-xs text-cream-muted">You’re not in any Spaces with other members yet.</p>
      ) : null}
      <div className="grid gap-2">
        {rows?.map((row) => (
          <div key={row.spaceId} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm">{row.spaceName}</span>
            <OptionSelect
              className="w-44 shrink-0"
              aria-label={`Requests from ${row.spaceName}`}
              value={row.policy}
              options={options}
              disabled={saving === row.spaceId}
              onValueChange={(value) => void change(row, value as AcceptPolicy)}
            />
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
    </section>
  );
}
