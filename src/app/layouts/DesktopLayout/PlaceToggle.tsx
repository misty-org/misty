import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useAuth } from "@/features/account";
import { useDms, useFriends } from "@/features/direct";
import { useSpacesStore } from "@/features/spaces";
import { ChoiceGroup, IndicatorDot, spaceIcons } from "@misty/ui";
import { AccountAvatar } from "./NavRail";
import { choosePlace, usePlace, useSpacesSideFollowsSpaces, type Place } from "./placeStore";

const SpaceIcon = spaceIcons.space;

/** Something waits on the person in Personal: an unread DM, or a friend request. */
function usePersonalWaiting(): boolean {
  const dms = useDms().data;
  const friends = useFriends().data;
  return Boolean(dms?.some((dm) => dm.unread_count > 0) || (friends?.incoming.length ?? 0) > 0);
}

/** Someone @mentioned the person in a shared Space while they were in Personal. */
const useSpacesMention = create<{ waiting: boolean }>(() => ({ waiting: false }));

/**
 * Watches new messages for an @mention of the person in one of their shared Spaces (never a DM or
 * Personal) while the sidebar is on Personal; going to Spaces clears it.
 */
function useSpacesMentionWaiting(place: Place): boolean {
  const { user } = useAuth();
  const placeRef = useRef(place);
  placeRef.current = place;
  useEffect(() => {
    if (place === "spaces") useSpacesMention.setState({ waiting: false });
  }, [place]);
  useEffect(() => {
    const myId = user?.id;
    if (!myId) return;
    const onMessage = (raw: Event) => {
      const detail = (
        raw as CustomEvent<{
          spaceId?: string;
          event?: { type?: string; payload?: Record<string, unknown> };
        }>
      ).detail;
      if (placeRef.current === "spaces" || detail?.event?.type !== "message.created") return;
      const payload = detail.event.payload ?? {};
      if (payload.sender_user_id === myId) return;
      const space = useSpacesStore.getState().spaces.find((item) => item.id === detail.spaceId);
      if (!space || space.is_default) return;
      const content = Array.isArray(payload.content)
        ? (payload.content as { user_id?: unknown }[])
        : [];
      if (content.some((span) => span.user_id === myId))
        useSpacesMention.setState({ waiting: true });
    };
    window.addEventListener("misty:space-message-event", onMessage);
    return () => window.removeEventListener("misty:space-message-event", onMessage);
  }, [user?.id]);
  return useSpacesMention((state) => state.waiting);
}

/**
 * The sidebar's switch between Personal (the person's own face) and Spaces (the galaxy), in its
 * top row after the sidebar toggle. A dot marks Personal while something waits there (an unread
 * DM or a friend request), and Spaces after an @mention in a shared Space.
 */
export function PlaceToggle() {
  const place = usePlace();
  useSpacesSideFollowsSpaces();
  const personalWaiting = usePersonalWaiting();
  const spacesWaiting = useSpacesMentionWaiting(place);
  return (
    <ChoiceGroup<Place>
      label="Personal or Spaces"
      value={place}
      onChange={choosePlace}
      options={[
        {
          value: "personal",
          label: "Personal",
          iconOnly: true,
          icon: (
            <span className="relative inline-flex">
              <AccountAvatar size="xs" />
              {personalWaiting ? <IndicatorDot /> : null}
            </span>
          ),
        },
        {
          value: "spaces",
          label: "Spaces",
          iconOnly: true,
          // A dot while someone @mentioned the person in a shared Space they haven't gone to.
          icon: (
            <span className="relative inline-flex">
              <SpaceIcon />
              {spacesWaiting ? <IndicatorDot /> : null}
            </span>
          ),
        },
      ]}
    />
  );
}
