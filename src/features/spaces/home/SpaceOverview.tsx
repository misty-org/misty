import { useUserStore } from "@/features/account/core";
import { SpaceFoldersSection } from "../folders/SpaceFoldersSection";
import { ComingUpCard } from "./ComingUpCard";
import { HandoffsCard } from "./HandoffsCard";
import { ChannelsCard } from "./ChannelsCard";
import { ForYouCard } from "./ForYouCard";
import { homePairClass } from "./homeLayout";
import { SpaceActivityLog } from "./SpaceActivityLog";
import { WorkingOn } from "./WorkingOn";

/**
 * The middle of a Space's home, in pairs: what is waiting for the person beside what is coming up,
 * the channels with something new beside what members' agents are working on, then what the Space's
 * agents did lately beside the folders members shared into it. A Space of one skips the panels about
 * other people, and a panel with nothing in it leaves itself out. Who is here is the members panel's,
 * not a card's. The Space's recent things are the home's own collection below.
 */
export function SpaceOverview({
  spaceId,
  shared,
}: {
  spaceId: string;
  /** Other people are in this Space, so the panels about them show. */
  shared: boolean;
}) {
  const me = useUserStore((state) => state.me?.id ?? "");
  return (
    <div className={`${homePairClass} empty:hidden`}>
      <ForYouCard spaceId={spaceId} />
      <ComingUpCard spaceId={spaceId} />
      {shared && <HandoffsCard spaceId={spaceId} />}
      <ChannelsCard spaceId={spaceId} />
      {shared && <WorkingOn spaceId={spaceId} me={me} />}
      <SpaceActivityLog spaceId={spaceId} />
      <SpaceFoldersSection spaceId={spaceId} />
    </div>
  );
}
