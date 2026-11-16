import { useUserStore } from "@/features/account/core";
import { ComingUpCard } from "./ComingUpCard";
import { HandoffsCard } from "./HandoffsCard";
import { HereNowCard, type HereNowPerson } from "./HereNow";
import { homePairClass } from "./homeLayout";
import { ProjectFoldersCard } from "./ProjectFoldersCard";
import { SpaceChatCard } from "./SpaceChatCard";
import { WorkingOn } from "./WorkingOn";

/**
 * The middle of a Space's home, about the Space itself rather than anyone's agents: handoffs
 * waiting for the person, who's here beside the Space chat, what members are working on beside
 * what's coming up, and the folders the Space works in. A Space of one skips the panels about
 * other people, and a panel with nothing in it leaves itself out. The panels flow two to a row;
 * the Space's things are the home's own collection below them.
 */
export function SpaceOverview({
  spaceId,
  shared,
  here = [],
}: {
  spaceId: string;
  /** Other people are in this Space, so the panels about them show. */
  shared: boolean;
  /** Who is in the Space now and where. */
  here?: HereNowPerson[];
}) {
  const me = useUserStore((state) => state.me?.id ?? "");
  return (
    <div className={`${homePairClass} empty:hidden`}>
      {shared && <HandoffsCard spaceId={spaceId} />}
      {shared && <HereNowCard spaceId={spaceId} here={here} />}
      <SpaceChatCard spaceId={spaceId} />
      {shared && <WorkingOn spaceId={spaceId} me={me} />}
      <ComingUpCard spaceId={spaceId} />
      <ProjectFoldersCard />
    </div>
  );
}
