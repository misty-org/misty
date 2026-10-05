import { spaceAgentsApi } from "@/api/spaces/space-agents";
import { useSpacesStore } from "@/features/spaces";
import { Button, Skeleton } from "@/shared/ui";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The Spaces an agent is in. Anyone in a Space can @mention the agent there
 * and ask it for work, which they pay for. It works only in that Space and
 * never sees your private chats or apps.
 */
export function AgentSpaceField({ agentId }: { agentId: string }) {
  const spaces = useSpacesStore((state) => state.spaces);
  const [joined, setJoined] = useState<Set<string>>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!useSpacesStore.getState().spaces.length) void useSpacesStore.getState().load();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setJoined(undefined);
    spaceAgentsApi
      .mine(controller.signal)
      .then(({ agents }) =>
        setJoined(
          new Set(agents.filter((item) => item.agent_id === agentId).map((item) => item.space_id)),
        ),
      )
      .catch(() => !controller.signal.aborted && setError("This agent’s Spaces couldn’t load."));
    return () => controller.abort();
  }, [agentId]);
  const toggle = async (spaceId: string) => {
    if (!joined || busy) return;
    const inSpace = joined.has(spaceId);
    setBusy(spaceId);
    setError("");
    try {
      if (inSpace) await spaceAgentsApi.remove(spaceId, agentId);
      else await spaceAgentsApi.add(spaceId, agentId);
      const next = new Set(joined);
      if (inSpace) next.delete(spaceId);
      else next.add(spaceId);
      setJoined(next);
    } catch {
      setError("That change couldn’t be saved. Try again.");
    } finally {
      setBusy("");
    }
  };
  return (
    <section aria-label="Spaces" className="border-t border-charcoal-border pt-5">
      <h3 className="m-0 text-sm font-medium">Spaces</h3>
      <p className="mb-2 mt-1 text-xs text-cream-muted">
        Anyone in these Spaces can @mention this agent and ask it for work, which they pay for. It
        works only in that Space and never sees your private chats or apps.
      </p>
      {!joined && !error ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="grid gap-1" role="group" aria-label="Spaces this agent is in">
          {spaces.map((space) => {
            const checked = Boolean(joined?.has(space.id));
            return (
              <Button
                key={space.id}
                variant="ghost"
                justify="start"
                role="checkbox"
                aria-checked={checked}
                disabled={!joined || busy !== ""}
                onClick={() => void toggle(space.id)}
              >
                <Check className={checked ? "" : "invisible"} />
                <span className="truncate">
                  {space.is_default && space.role === "owner"
                    ? `${space.name} (personal)`
                    : space.name}
                </span>
              </Button>
            );
          })}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
    </section>
  );
}
