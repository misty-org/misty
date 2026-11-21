import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import { Avatar, AvatarFallback, IconButton, SideCard, Surface, Text } from "@misty/ui";
import { personTone } from "@/shared/lib/personTone";
import { personInitials } from "@/shared/lib/personInitials";
import { useSpacesStore } from "@/features/spaces";
import { useDms } from "../directData";
import { dmOf, type ActiveCall } from "./callStore";
import { useLiveKitCall, type CallPerson } from "./useLiveKitCall";
import { useCallAgent } from "./useCallAgent";

/** A camera or a shared screen, playing in its tile. Its sound plays separately. */
function TrackVideo({ track, self }: { track: Track; self: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={self}
      className="size-full object-cover"
      aria-hidden="true"
    />
  );
}

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
  return <audio ref={ref} autoPlay className="hidden" />;
}

function PersonTile({ person, name }: { person: CallPerson; name: string }) {
  return (
    <figure className="grid min-w-0 gap-1">
      <Surface
        tone="well"
        radius="lg"
        className="flex aspect-video items-center justify-center overflow-hidden"
      >
        {person.video ? (
          <TrackVideo track={person.video} self={person.self} />
        ) : (
          <Avatar size="lg" tone={personTone(person.id)}>
            <AvatarFallback>{personInitials(name)}</AvatarFallback>
          </Avatar>
        )}
      </Surface>
      <figcaption className="flex min-w-0 items-center gap-1">
        <Text size="meta" tone={person.speaking ? "bright" : "muted"} className="min-w-0 flex-1">
          {person.self ? "You" : name}
        </Text>
        {person.micOn ? null : (
          <Text bare tone="muted" aria-label="Muted">
            <MicOff aria-hidden="true" />
          </Text>
        )}
      </figcaption>
      {person.audio.map((track) => (
        <TrackAudio key={track.sid ?? track.mediaStreamTrack.id} track={track} />
      ))}
    </figure>
  );
}

/**
 * The call this window is in, as a narrow card over the window's top right: everyone's camera or
 * shared screen (their face when neither is on), then Mute, Camera, Share screen and Leave.
 */
export function CallPanel({ call, maxPeople }: { call: ActiveCall; maxPeople: number }) {
  const controls = useLiveKitCall(call, maxPeople);
  const dms = useDms().data;
  const dmMembers = dms?.find((dm) => dm.id === dmOf(call))?.members;
  const spaceMembers = useSpacesStore((state) =>
    call.place.kind === "voice" ? state.membersBySpace[call.place.spaceId] : undefined,
  );
  // People are named as the DM or the Space knows them; the token's name otherwise.
  const nameOf = (person: CallPerson) =>
    dmMembers?.find((member) => member.user_id === person.id)?.username ??
    spaceMembers?.find((member) => member.user_id === person.id)?.name ??
    person.name;
  const others = controls.people.filter((person) => !person.self);
  const agent = useCallAgent({
    room: controls.room,
    call,
    nameOf: (userId) =>
      dmMembers?.find((member) => member.user_id === userId)?.username ??
      spaceMembers?.find((member) => member.user_id === userId)?.name ??
      "Someone",
  });
  // A voice channel is named for itself; a DM call for who else is in it.
  const waiting = call.place.kind === "voice" ? call.place.name : "Waiting for others to join";
  return (
    <SideCard label="Call" className="pointer-events-auto">
      <div className="grid gap-3 p-3">
        <Text size="control" weight="semibold" tone="bright">
          {call.state === "connecting"
            ? "Connecting"
            : others.length
              ? others.map(nameOf).join(", ")
              : waiting}
        </Text>
        {controls.people.length ? (
          <div className="grid grid-cols-2 gap-2">
            {controls.people.map((person) => (
              <PersonTile key={person.id} person={person} name={nameOf(person)} />
            ))}
          </div>
        ) : null}
        {agent.rows}
        <div className="flex items-center justify-center gap-1" role="toolbar" aria-label="Call controls">
          <IconButton
            label={controls.micOn ? "Mute" : "Unmute"}
            aria-pressed={!controls.micOn}
            disabled={call.state !== "live"}
            onClick={controls.toggleMic}
          >
            {controls.micOn ? <Mic /> : <MicOff />}
          </IconButton>
          <IconButton
            label={controls.cameraOn ? "Turn camera off" : "Turn camera on"}
            aria-pressed={controls.cameraOn}
            disabled={call.state !== "live"}
            onClick={controls.toggleCamera}
          >
            {controls.cameraOn ? <Video /> : <VideoOff />}
          </IconButton>
          <IconButton
            label={controls.screenOn ? "Stop sharing" : "Share screen"}
            aria-pressed={controls.screenOn}
            disabled={call.state !== "live"}
            onClick={controls.toggleScreen}
          >
            <MonitorUp />
          </IconButton>
          {agent.trigger}
          <IconButton label="Leave" variant="danger" onClick={controls.leave}>
            <PhoneOff />
          </IconButton>
        </div>
      </div>
    </SideCard>
  );
}
