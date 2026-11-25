import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Track } from "livekit-client";
import { useNotice } from "@misty/ui";
import { useUserStore } from "@/features/account";
import { useSpacesStore } from "@/features/spaces";
import { useDms } from "../direct_data";
import { dmOf, type ActiveCall } from "./call_store";
import { callPath, useCallSession } from "./call_session_store";
import { useCallAgent } from "./UseCallAgent";
import { useLiveKitCall } from "./use_live_kit_call";
import { useCallShortcuts } from "./use_call_shortcuts";

function TrackAudio({ track, muted }: { track: Track; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return <audio ref={ref} autoPlay hidden muted={muted} />;
}

export function CallSession({ call, maxPeople }: { call: ActiveCall; maxPeople: number }) {
  const controls = useLiveKitCall(call, maxPeople);
  const dms = useDms().data;
  const dmMembers = dms?.find((dm) => dm.id === dmOf(call))?.members;
  const spaceMembers = useSpacesStore((state) =>
    call.place.kind === "voice" ? state.membersBySpace[call.place.spaceId] : undefined,
  );
  const nameOf = (userId: string) =>
    dmMembers?.find((member) => member.user_id === userId)?.username ??
    spaceMembers?.find((member) => member.user_id === userId)?.name ??
    "Someone";
  const me = useUserStore((state) => state.me);
  const faceOf = (userId: string) =>
    dmMembers?.find((member) => member.user_id === userId) ??
    spaceMembers?.find((member) => member.user_id === userId) ??
    (me && me.id === userId ? me : undefined);
  const others = controls.people.filter((person) => !person.self).length;
  const agent = useCallAgent({
    room: controls.room,
    call,
    key: controls.baseKey,
    others,
    nameOf,
  });
  const live = call.state === "live";
  useCallShortcuts(controls, live);
  const navigate = useNavigate();
  const title =
    call.place.kind === "voice"
      ? call.place.name
      : controls.people
          .filter((person) => !person.self)
          .map((person) => nameOf(person.id))
          .join(", ") || "Call";

  useEffect(() => {
    useCallSession.getState().publish({
      where: {
        kind: "people",
        title,
        live,
        canShow: true,
        voiceSpaceId: call.place.kind === "voice" ? call.place.spaceId : undefined,
        open: () => navigate(callPath(call)),
        isHome: ({ pathname }) => {
          const home = callPath(call);
          return pathname === home || pathname.startsWith(`${home}/`);
        },
      },
      controls: {
        ...controls,
        people: controls.people.map((person) => ({ ...person, name: nameOf(person.id) })),
      },
      agent,
      nameOf,
      faceOf,
    });
  });
  useEffect(() => () => useCallSession.getState().clear(), []);
  useNotice(controls.reconnecting, {
    message: "Reconnecting. Your audio and video come back on their own.",
  });
  useNotice(controls.offerLowerHand, {
    message: "You’re talking with your hand up.",
    action: { label: "Lower hand", onSelect: controls.toggleHand },
  });
  useNotice(controls.silentMic && controls.micOn && !controls.reconnecting, {
    message: "Your microphone isn’t picking anything up.",
    action: {
      label: "Choose another",
      onSelect: () => useCallSession.getState().setDevicesOpen("audio"),
    },
  });

  return (
    <>
      {controls.people.flatMap((person) =>
        person.audio.map((track) => (
          <TrackAudio
            key={track.sid ?? track.mediaStreamTrack.id}
            track={track}
            muted={controls.deafened}
          />
        )),
      )}
    </>
  );
}
