import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";
import { useSpacesStore } from "@/features/spaces";
import { useDms } from "../directData";
import { dmOf, type ActiveCall } from "./callStore";
import { useCallSession } from "./callSessionStore";
import { useCallAgent } from "./useCallAgent";
import { useLiveKitCall } from "./useLiveKitCall";

/** Someone's voice, or their screen's sound. */
function TrackAudio({ track }: { track: Track }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return <audio ref={ref} autoPlay hidden />;
}

/**
 * The call this window is in, joined once at the window's root and kept there whatever the window
 * shows: it publishes the call's controls for its page, a DM, full screen and the mini player
 * (`callSession.ts`), and plays everyone's voice here, so the sound never stops as the call moves
 * between them.
 */
export function CallSession({ call, maxPeople }: { call: ActiveCall; maxPeople: number }) {
  const controls = useLiveKitCall(call, maxPeople);
  const dms = useDms().data;
  const dmMembers = dms?.find((dm) => dm.id === dmOf(call))?.members;
  const spaceMembers = useSpacesStore((state) =>
    call.place.kind === "voice" ? state.membersBySpace[call.place.spaceId] : undefined,
  );
  // People are named as the DM or the Space knows them; the token's name otherwise.
  const nameOf = (userId: string) =>
    dmMembers?.find((member) => member.user_id === userId)?.username ??
    spaceMembers?.find((member) => member.user_id === userId)?.name ??
    controls.people.find((person) => person.id === userId)?.name ??
    "Someone";
  const others = controls.people.filter((person) => !person.self).length;
  const agent = useCallAgent({ room: controls.room, call, others, nameOf });

  // After every render: the controls carry the call's live people and tracks.
  useEffect(() => {
    useCallSession.getState().publish({ controls, agent, nameOf });
  });
  useEffect(() => () => useCallSession.getState().clear(), []);

  return (
    <>
      {controls.people.flatMap((person) =>
        person.audio.map((track) => (
          <TrackAudio key={track.sid ?? track.mediaStreamTrack.id} track={track} />
        )),
      )}
    </>
  );
}
