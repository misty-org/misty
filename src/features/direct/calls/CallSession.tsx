import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";
import { useNotice } from "@misty/ui";
import { useSpacesStore } from "@/features/spaces";
import { useDms } from "../direct_data";
import { dmOf, type ActiveCall } from "./call_store";
import { useCallSession } from "./call_session_store";
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
  const others = controls.people.filter((person) => !person.self).length;
  const agent = useCallAgent({
    room: controls.room,
    call,
    key: controls.baseKey,
    others,
    nameOf,
  });
  useCallShortcuts(controls);

  useEffect(() => {
    useCallSession.getState().publish({
      controls: {
        ...controls,
        people: controls.people.map((person) => ({ ...person, name: nameOf(person.id) })),
      },
      agent,
      nameOf,
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
