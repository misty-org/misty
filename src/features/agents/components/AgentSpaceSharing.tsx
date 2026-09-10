import { agentMemberRequestsApi, type AcceptPolicy } from "@/features/agent-member-requests/api";
import { OptionSelect, Skeleton } from "@/shared/ui";
import { useEffect, useState } from "react";

const options = [
  { value: "ask", label: "Ask me first" },
  { value: "auto", label: "Start right away" },
  { value: "off", label: "Off" },
];

/**
 * How the agent takes requests from its Space: members can @mention it in the
 * Space chat and their agents can ask it for help. It works only in that Space
 * with your permissions there, and whoever asks pays for the work.
 */
export function AgentSpaceSharing({ agentId, spaceId }: { agentId: string; spaceId: string }) {
  const [policy, setPolicy] = useState<AcceptPolicy>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setPolicy(undefined);
    setError("");
    agentMemberRequestsApi
      .listings(spaceId)
      .then(({ listings }) => {
        if (!live) return;
        setPolicy(listings.find((listing) => listing.agent_id === agentId)?.accept_policy ?? "ask");
      })
      .catch(() => live && setError("Request settings couldn’t load."));
    return () => {
      live = false;
    };
  }, [agentId, spaceId]);
  const change = async (next: AcceptPolicy) => {
    const previous = policy;
    setPolicy(next);
    setSaving(true);
    setError("");
    try {
      if (next === "off") await agentMemberRequestsApi.unpublish(spaceId, agentId);
      else await agentMemberRequestsApi.publish(spaceId, agentId, next);
    } catch {
      setPolicy(previous);
      setError("That change couldn’t be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label="Requests from the Space" className="border-t border-charcoal-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Requests from the Space</h3>
        {policy ? (
          <OptionSelect
            className="w-44 shrink-0"
            aria-label="Requests from the Space"
            value={policy}
            options={options}
            disabled={saving}
            onValueChange={(value) => void change(value as AcceptPolicy)}
          />
        ) : error ? null : (
          <Skeleton className="h-8 w-44" />
        )}
      </div>
      <p className="mt-1 text-xs text-cream-muted">
        Members can @mention this agent in the Space chat, and their agents can ask it for help. It
        works only in this Space, never sees your private chats or apps, and whoever asks pays for
        the work.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
    </section>
  );
}
