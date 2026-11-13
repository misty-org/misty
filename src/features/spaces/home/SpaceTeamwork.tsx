import { useState } from "react";
import { Text, useNotice } from "@/shared/ui";
import { HandoffActions } from "../handoffs/HandoffActions";
import { postedAgo } from "../handoffs/spacePosts";
import { useIncomingHandoffs } from "../handoffs/useIncomingHandoffs";
import { homePairClass } from "./homeLayout";
import { OverviewCard } from "./OverviewCard";
import { SpaceActivityLog } from "./SpaceActivityLog";
import { WorkingOn } from "./WorkingOn";
import { useNow } from "@/shared/hooks/useNow";

/**
 * How the members of a shared Space pass work to each other: the handoffs waiting for this
 * person, what everyone said they are working on, and what their agents did lately.
 */
export function SpaceTeamwork({ spaceId }: { spaceId: string }) {
  const { handoffs, me } = useIncomingHandoffs(spaceId);
  const [error, setError] = useState("");
  const now = useNow();
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (
    <>
      <div className={homePairClass}>
        {handoffs?.length ? (
          <OverviewCard title="Handoffs waiting for you" count={handoffs.length} tone="attention">
            <ul className="m-0 grid list-none gap-1 p-0">
              {handoffs.map((handoff) => (
                <li key={handoff.id} className="grid gap-2 rounded-[10px] px-2.5 py-2">
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
    </>
  );
}
