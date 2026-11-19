import { useEffect, useMemo, useState } from "react";
import { useUserStore } from "@/features/account/core";
import { useStudioOpen, useTeamMembers, type TeamMember } from "@/features/agents";
import { useWindowSpace } from "../components/space-row/useWindowSpace";
import { notesApi } from "../journal/notes/api/api";
import { memberPicture } from "../members/memberPictures";
import { useSpacesStore } from "./useSpacesStore";

/** A Lab notebook's doc is titled with this, the way the Lab finds them among a Space's docs. */
const NOTEBOOK_PREFIX = "Notebook: ";

/**
 * While something that shows the Space's members is open (the Lab), tells it who else is in the
 * window's Space and which notebook each has open, from the Space's live presence. Nothing is
 * read while nothing shows them.
 */
export function SpaceStudioPeople() {
  const open = useStudioOpen((state) => state.open > 0);
  const space = useWindowSpace();
  if (!open || !space?.is_shared) return null;
  return <StudioPeople key={space.id} spaceId={space.id} />;
}

function StudioPeople({ spaceId }: { spaceId: string }) {
  const me = useUserStore((state) => state.me?.id ?? "");
  const viewers = useSpacesStore((state) => state.presenceBySpace[spaceId]);
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  const [faces, setFaces] = useState<Record<string, string | null>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!members) void useSpacesStore.getState().loadMembers(spaceId);
  }, [members, spaceId]);

  const people = useMemo<TeamMember[]>(() => {
    const seen = new Set<string>();
    return (viewers ?? []).flatMap((viewer) => {
      if (viewer.user_id === me || seen.has(viewer.user_id)) return [];
      seen.add(viewer.user_id);
      const member = members?.find((candidate) => candidate.user_id === viewer.user_id);
      if (!member) return [];
      return [
        {
          userId: viewer.user_id,
          name: member.name || member.email,
          picture: faces[viewer.user_id] ?? undefined,
          place: viewer.place === "lab" ? ("lab" as const) : undefined,
          // The notebook they have open in the Lab.
          notebook: viewer.place === "lab" && viewer.item_id ? titles[viewer.item_id] : undefined,
          notebookDoc: (viewer.place === "lab" && viewer.item_id) || undefined,
          active: viewer.active,
        },
      ];
    });
  }, [viewers, members, me, faces, titles]);

  useEffect(() => {
    useTeamMembers.getState().show(people);
  }, [people]);
  useEffect(() => () => useTeamMembers.getState().show([]), []);

  // Pictures, once members say which of them have one.
  useEffect(() => {
    if (!members) return;
    let live = true;
    for (const person of people) {
      if (person.userId in faces) continue;
      const version = members.find((member) => member.user_id === person.userId)?.avatar_version;
      void memberPicture(spaceId, person.userId, version ?? 0).then((url) => {
        if (live) setFaces((known) => ({ ...known, [person.userId]: url }));
      });
    }
    return () => {
      live = false;
    };
  }, [people, members, faces, spaceId]);

  // A notebook someone has open is named from the Space's docs, read again only for a new one.
  // Only the Lab's ids are notebooks.
  const unknown = (viewers ?? []).some(
    (viewer) => viewer.place === "lab" && viewer.item_id && !(viewer.item_id in titles),
  );
  useEffect(() => {
    if (!unknown) return;
    let live = true;
    void notesApi
      .list(spaceId)
      .then(({ notes }) => {
        if (!live) return;
        const named: Record<string, string> = {};
        for (const note of notes)
          named[note.id] = note.title.startsWith(NOTEBOOK_PREFIX)
            ? note.title.slice(NOTEBOOK_PREFIX.length)
            : note.title;
        // Ids that aren't docs here stay unnamed, so they aren't asked about again.
        for (const viewer of useSpacesStore.getState().presenceBySpace[spaceId] ?? [])
          if (viewer.place === "lab" && viewer.item_id && !(viewer.item_id in named))
            named[viewer.item_id] = "";
        setTitles((known) => ({ ...known, ...named }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [unknown, spaceId]);

  return null;
}
