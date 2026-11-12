import { useState } from "react";
import { ErrorNotification } from "@/shared/ui";
import { HandoffActions } from "../handoffs/HandoffActions";
import { postedAgo } from "../handoffs/spacePosts";
import { useIncomingHandoffs } from "../handoffs/useIncomingHandoffs";
import { OverviewCard } from "./OverviewCard";
import { SpaceActivityLog } from "./SpaceActivityLog";
import { WorkingOn } from "./WorkingOn";

/**
 * How the members of a shared Space pass work to each other: the handoffs waiting for this
 * person, what everyone said they are working on, and what their agents did lately.
 */
export function SpaceTeamwork({ spaceId }: { spaceId: string }) {
  const { handoffs, me } = useIncomingHandoffs(spaceId);
  const [error, setError] = useState("");
  const now = Date.now();
  return (
    <>
      <div className="home-pair">
        {handoffs?.length ? (
          <OverviewCard title="Handoffs waiting for you" count={handoffs.length} tone="attention">
            <ul className="m-0 grid list-none gap-1 p-0">
              {handoffs.map((handoff) => (
                <li key={handoff.id} className="grid gap-2 rounded-[10px] px-2.5 py-2">
                  <span className="flex min-w-0 items-baseline gap-2 text-sm">
                    <span className="truncate text-cream">{handoff.fromName}</span>
                    <span className="shrink-0 text-xs text-cream-muted">
                      {postedAgo(handoff.createdAt, now)}
                    </span>
                  </span>
                  <p className="m-0 line-clamp-3 whitespace-pre-wrap text-sm leading-5 text-cream/90">
                    {handoff.text}
                  </p>
                  <HandoffActions
                    spaceId={spaceId}
                    me={me}
                    handoffId={handoff.id}
                    text={handoff.text}
                    onError={setError}
                  />
                </li>
              ))}
            </ul>
          </OverviewCard>
        ) : null}
        <WorkingOn spaceId={spaceId} me={me} />
        <SpaceActivityLog spaceId={spaceId} />
      </div>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </>
  );
}
