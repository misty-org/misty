import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, Volume2 } from "lucide-react";
import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import {
  Avatar,
  AvatarFallback,
  Button,
  CallControl,
  CallLobby,
  CallTile,
  Surface,
  ViewHeader,
  notify,
} from "@misty/ui";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { useUserStore } from "@/features/account";
import { useSpaceConversations, useVoicePresence, watchVoicePresence } from "@/features/spaces";
import { personTone } from "@/shared/lib/person_tone";
import { personInitials } from "@/shared/lib/person_initials";
import { useDirectUserId } from "../direct_account";
import { useCallStore } from "./call_store";
import { CallStageView } from "./CallView";
import { joinVoiceChannel } from "./voice_channels";
import { savedCallDevice } from "./call_devices";
import { DeviceChoices, SpeakerChoices } from "./DeviceChoices";

function CameraPreview({ deviceId }: { deviceId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    let track: LocalVideoTrack | undefined;
    let cancelled = false;
    void createLocalVideoTrack({ deviceId: deviceId || undefined })
      .then((made) => {
        if (cancelled) {
          made.stop();
          return;
        }
        track = made;
        if (video) made.attach(video);
      })
      .catch(() => notify({ message: "The camera couldn’t be turned on.", tone: "error" }));
    return () => {
      cancelled = true;
      if (track) {
        if (video) track.detach(video);
        track.stop();
      }
    };
  }, [deviceId]);
  return <video ref={ref} autoPlay playsInline muted aria-hidden="true" />;
}

function peopleLine(count: number) {
  if (count === 0) return "Nobody is here yet.";
  if (count === 1) return "One person is here.";
  return `${count} people are here.`;
}

function Lobby({
  spaceId,
  channelId,
  name,
  people,
}: {
  spaceId: string;
  channelId: string;
  name: string;
  people: number;
}) {
  const userId = useDirectUserId();
  const username = useUserStore((state) => state.me?.username ?? "");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [joining, setJoining] = useState(false);
  const mic = savedCallDevice.audioinput((state) => state.value);
  const speaker = savedCallDevice.audiooutput((state) => state.value);
  const camera = savedCallDevice.videoinput((state) => state.value);
  const join = () => {
    if (!userId || joining) return;
    setJoining(true);
    setCameraOn(false);
    void joinVoiceChannel({ spaceId, channelId, name }, userId, {
      video: cameraOn,
      muted: !micOn,
    }).finally(() => setJoining(false));
  };
  return (
    <CallLobby
      preview={
        <CallTile
          name="You"
          muted={!micOn}
          picture={cameraOn ? <CameraPreview deviceId={camera} /> : undefined}
          face={
            <Avatar size="lg" tone={personTone(userId ?? username)}>
              <AvatarFallback>{personInitials(username || "You")}</AvatarFallback>
            </Avatar>
          }
        />
      }
      controls={
        <>
          <CallControl
            label={micOn ? "Mute" : "Unmute"}
            off={!micOn}
            onClick={() => setMicOn((on) => !on)}
            menuLabel="Audio devices"
            menu={
              <>
                <DeviceChoices
                  kind="audioinput"
                  title="Microphone"
                  value={mic}
                  onPick={(deviceId) => savedCallDevice.audioinput.getState().set(deviceId)}
                />
                <SpeakerChoices
                  value={speaker}
                  onPick={(deviceId) => savedCallDevice.audiooutput.getState().set(deviceId)}
                />
              </>
            }
          >
            {micOn ? <Mic /> : <MicOff />}
          </CallControl>
          <CallControl
            label={cameraOn ? "Turn camera off" : "Turn camera on"}
            off={!cameraOn}
            onClick={() => setCameraOn((on) => !on)}
            menuLabel="Cameras"
            menu={
              <DeviceChoices
                kind="videoinput"
                title="Camera"
                value={camera}
                onPick={(deviceId) => savedCallDevice.videoinput.getState().set(deviceId)}
              />
            }
          >
            {cameraOn ? <Video /> : <VideoOff />}
          </CallControl>
        </>
      }
      title={name}
      line={peopleLine(people)}
      action={
        <Button variant="primary" size="lg" disabled={!userId || joining} onClick={join}>
          Join
        </Button>
      }
    />
  );
}

export function VoiceChannelPage({
  spaceId,
  channelId,
  workspaceTabId,
}: {
  spaceId: string;
  channelId: string;
  workspaceTabId?: string;
}) {
  const { conversations } = useSpaceConversations(spaceId);
  const name = conversations.find((item) => item.id === channelId)?.title ?? "Voice channel";
  const here = useCallStore(
    (state) =>
      state.active?.place.kind === "voice" &&
      state.active.place.spaceId === spaceId &&
      state.active.place.channelId === channelId,
  );
  const people = useVoicePresence((state) => state.bySpace[spaceId]?.[channelId]?.length ?? 0);
  useEffect(() => watchVoicePresence(spaceId), [spaceId]);
  useWorkspaceViewTitle(workspaceTabId, name);

  return (
    <Surface tone="page" className="flex h-full min-h-0 flex-col">
      <ViewHeader lead={Volume2} title={name} />
      {here ? (
        <CallStageView />
      ) : (
        <Lobby spaceId={spaceId} channelId={channelId} name={name} people={people} />
      )}
    </Surface>
  );
}
