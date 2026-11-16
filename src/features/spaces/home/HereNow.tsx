import { ChevronRight } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/features/account/core";
import { LabDoing, PersonAvatar, personTone } from "@/features/agents";
import { OverflowFadeText, Tooltip } from "@/shared/ui";
import { useSpacesStore } from "../list/useSpacesStore";
import type { GalleryItem } from "./galleryItems";
import { OverviewCard, OverviewRow } from "./OverviewCard";

export type HereNowPerson = Here;

interface Here {
  userId: string;
  name: string;
  /** Where they are: "In Lab · Photosynthesis", "In the Studio", "In this Space". */
  where: string;
  /** The Lab notebook they have open: its doc and title. */
  notebook?: { docId: string; title: string; href: string };
  mine: boolean;
}

/**
 * Who is in the Space right now and where, from its live presence; the Lab's notebooks are named
 * from the Space's own docs. Only a place and a doc id travel; nothing anyone typed.
 */
export function useHereNow(spaceId: string, items: GalleryItem[]): Here[] {
  const me = useUserStore((state) => state.me?.id ?? "");
  const viewers = useSpacesStore((state) => state.presenceBySpace[spaceId]);
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  useEffect(() => {
    if (!members) void useSpacesStore.getState().loadMembers(spaceId);
  }, [members, spaceId]);
  return useMemo(() => {
    const seen = new Set<string>();
    const people = (viewers ?? []).flatMap((viewer): Here[] => {
      if (seen.has(viewer.user_id)) return [];
      seen.add(viewer.user_id);
      const member = members?.find((candidate) => candidate.user_id === viewer.user_id);
      if (!member) return [];
      const doc = viewer.item_id
        ? items.find((item) => item.key === `note:${viewer.item_id}`)
        : undefined;
      const notebook =
        viewer.place === "lab" && viewer.item_id && doc
          ? { docId: viewer.item_id, title: doc.title, href: doc.href }
          : undefined;
      const where =
        viewer.place === "lab"
          ? notebook
            ? `In Lab · ${notebook.title}`
            : "In Lab"
          : viewer.place === "studio"
            ? "In the Studio"
            : "In this Space";
      const mine = viewer.user_id === me;
      return [
        {
          userId: viewer.user_id,
          name: mine ? "You" : member.name || member.email,
          where,
          notebook,
          mine,
        },
      ];
    });
    // The others first, then the person themself.
    return people.sort((a, b) => Number(a.mine) - Number(b.mine) || a.name.localeCompare(b.name));
  }, [viewers, members, items, me]);
}

/** The others here now, as faces for the Space's bar, each saying where they are. */
export function HereFaces({ spaceId, here }: { spaceId: string; here: Here[] }) {
  const others = here.filter((person) => !person.mine);
  if (!others.length) return null;
  return (
    <span className="flex flex-none items-center -space-x-1.5" aria-label="Here now">
      {others.slice(0, 4).map((person) => (
        <Tooltip key={person.userId} content={`${person.name} · ${person.where}`}>
          <span className="inline-flex">
            <PersonAvatar
              spaceId={spaceId}
              person={{ id: person.userId, name: person.name, tone: personTone(person.userId) }}
            />
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

/**
 * Who is in the Space now, beside what's happening in it: each person, where they are, and what
 * they're doing in a Lab notebook ("Sam is making a quiz"). A Space of one shows nothing.
 */
export function HereNowCard({ spaceId, here }: { spaceId: string; here: Here[] }) {
  const navigate = useNavigate();
  if (!here.some((person) => !person.mine)) return null;
  return (
    <OverviewCard title="Here now" count={here.length}>
      {here.map((person) => (
        <OverviewRow
          key={person.userId}
          leading={
            <PersonAvatar
              spaceId={spaceId}
              person={{ id: person.userId, name: person.name, tone: personTone(person.userId) }}
            />
          }
          title={person.name}
          detail={
            <>
              <OverflowFadeText>{person.where}</OverflowFadeText>
              {person.notebook && !person.mine ? (
                <LabDoing
                  userId={person.userId}
                  name={person.name}
                  docId={person.notebook.docId}
                  before={<span aria-hidden="true">·</span>}
                />
              ) : null}
            </>
          }
          trailing={person.notebook ? <ChevronRight aria-hidden="true" /> : undefined}
          onOpen={() => (person.notebook ? navigate(person.notebook.href) : undefined)}
        />
      ))}
    </OverviewCard>
  );
}
