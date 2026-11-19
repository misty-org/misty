import { useState } from "react";
import { Text, useNotice } from "@/shared/ui";
import { HandoffActions } from "../handoffs/HandoffActions";
import { postedAgo } from "../handoffs/spacePosts";
import { useIncomingHandoffs } from "../handoffs/useIncomingHandoffs";
import { OverviewCard, OverviewRowsSkeleton } from "./OverviewCard";
import { useNow } from "@/shared/hooks/useNow";

/**
 * The handoffs other members passed to this person in a shared Space, each with what they can do
 * about it. Nothing shows while none are waiting.
 */
export function HandoffsCard({ spaceId }: { spaceId: string }) {
  const { handoffs, me } = useIncomingHandoffs(spaceId);
  const [error, setError] = useState("");
  const now = useNow();
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  // The first read: the card's shape stands in. Once read, the card is left out with none waiting.
  if (!handoffs)
    return (
      <OverviewCard title="Handoffs waiting for you">
        <OverviewRowsSkeleton rows={2} trailing={false} />
      </OverviewCard>
    );
  if (!handoffs.length) return null;
  return (
    <OverviewCard title="Handoffs waiting for you" count={handoffs.length} tone="attention">
      <ul className="m-0 grid list-none gap-1 p-0">
        {handoffs.map((handoff) => (
          <li key={handoff.id} className="grid gap-2 rounded-[0.625rem] px-2.5 py-2">
            <span className="flex min-w-0 items-baseline gap-2 text-sm">
              <Text full tone="default">
                {handoff.fromName}
              </Text>
              <Text bare tone="muted" className="shrink-0 text-xs">
                {postedAgo(handoff.createdAt, now)}
              </Text>
            </span>
            <Text
              as="p"
              tone="default"
              lines={3}
              className="m-0 whitespace-pre-wrap text-sm leading-5"
            >
              {handoff.text}
            </Text>
            <HandoffActions
              spaceId={spaceId}
              me={me}
              handoffId={handoff.id}
              text={handoff.text}
              agentId={handoff.agentId}
              onError={setError}
            />
          </li>
        ))}
      </ul>
    </OverviewCard>
  );
}
