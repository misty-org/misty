import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  Captions,
  CaptionsOff,
  Eye,
  EyeOff,
  Hand,
  Headphones,
  HeadphoneOff,
  LogOut,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  PictureInPicture2,
  Video,
  VideoOff,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  CallBar,
  CallCaptions,
  CallControl,
  CallLeave,
  CallReactions,
  CallStage,
  CallTile,
  FloatingPip,
  IconButton,
  MenuItem,
  Text,
  ToolbarDivider,
  ZoomControl,
} from "@misty/ui";
import { AgentAvatar, useAgentScreen } from "@/features/agents";
import { openSettings } from "@/features/settings";
import { useMemberPicture, useSpaceCan } from "@/features/spaces";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { personTone } from "@/shared/lib/person_tone";
import { personInitials } from "@/shared/lib/person_initials";
import { useCallSession } from "./call_session_store";
import type { CallAgentView } from "./call_agents";
import type { CallPerson, CallVideo } from "./use_live_kit_call";
import { CallFullscreenFrame } from "./CallFullscreenFrame";
import { DeviceChoices } from "./DeviceChoices";
import { MicrophoneMenu, SpeakerMenu } from "./CallAudioControls";
import { callReactions } from "./call_reactions";
import { CallPersonMenu } from "./CallPersonMenu";
import { featured, useStableOrder } from "./call_stage_order";

const playing = new Map<CallVideo, HTMLVideoElement>();

function TrackVideo({ track, self }: { track: CallVideo; self: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    playing.set(track, element);
    return () => {
      track.detach(element);
      if (playing.get(track) === element) playing.delete(track);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted={self} aria-hidden="true" />;
}

function Face({ person, name }: { person: CallPerson; name: string }) {
  const face = useCallSession((state) => state.faceOf(person.id));
  const picture = useMemberPicture(person.id, face?.avatar_version ?? 0);
  return (
    <Avatar
      size="lg"
      tone={personTone(person.id)}
      outline={avatarOutline(face?.avatar_decoration)}
    >
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback>{personInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

function AgentTile({
  agent,
  name,
  onRemove,
}: {
  agent: CallAgentView;
  name: string;
  onRemove?: () => void;
}) {
  const page = useAgentScreen(agent.conversationId);
  const busy = agent.state === "thinking" || agent.state === "working";
  const shown = busy && page ? page : undefined;
  return (
    <CallTile
      name={shown ? `${name}’s screen` : name}
      speaking={agent.state === "speaking"}
      muted={agent.state === "working"}
      deafened={agent.state === "working"}
      fit="contain"
      picture={shown ? <img src={shown} alt="" draggable={false} /> : undefined}
      face={
        agent.profile ? (
          <AgentAvatar agent={agent.profile} large />
        ) : (
          <Avatar size="lg" tone={personTone(agent.key)}>
            <AvatarFallback>{personInitials(agent.name)}</AvatarFallback>
          </Avatar>
        )
      }
      actions={
        onRemove ? (
          <IconButton label={`Send ${agent.name} away`} onClick={onRemove}>
            <LogOut />
          </IconButton>
        ) : undefined
      }
    />
  );
}

const zoomLevels = [1, 1.5, 2, 3];

export function CallStageView() {
  const where = useCallSession((state) => state.where);
  const controls = useCallSession((state) => state.controls);
  const agent = useCallSession((state) => state.agent);
  const nameOf = useCallSession((state) => state.nameOf);
  const pinned = useCallSession((state) => state.pinned);
  const fullscreen = useCallSession((state) => state.fullscreen);
  const devicesOpen = useCallSession((state) => state.devicesOpen);
  const screenZoom = useCallSession((state) => state.screenZoom);
  const live = Boolean(where?.live);
  const withPeople = where?.kind !== "agent";
  const canShow = where?.canShow ?? true;
  const voiceSpaceId = where?.voiceSpaceId;
  const moderator = useSpaceCan(voiceSpaceId ?? "", "members.remove");
  const everyone = controls?.people ?? [];
  const pickedNow = everyone.find((person) => person.id === pinned);
  const sharingNow = everyone.some((person) => !person.self && person.sharing);
  const ordered = useStableOrder(everyone, Boolean(pickedNow || sharingNow));
  if (!controls) return null;
  const people = ordered;
  const { pin, setFullscreen, setDevicesOpen, setScreenZoom } = useCallSession.getState();
  const label = (person: CallPerson) => (person.self ? "You" : nameOf(person.id));
  const voiceSettings = () => {
    setFullscreen(false);
    openSettings("voice");
  };

  const tile = (person: CallPerson, focused: boolean) => (
    <CallTile
      key={person.id}
      name={label(person)}
      speaking={person.speaking}
      muted={!person.micOn}
      deafened={person.deafened}
      weak={person.weak}
      hand={person.hand}
      handPlace={person.handPlace}
      reaction={person.reaction}
      picture={person.camera ? <TrackVideo track={person.camera} self={person.self} /> : undefined}
      mirror={person.self}
      face={<Face person={person} name={label(person)} />}
      actions={
        people.length > 1 ? (
          <CallPersonMenu
            person={person}
            controls={controls}
            focused={focused}
            onFocus={() => pin(focused ? null : person.id)}
            moderator={moderator && Boolean(voiceSpaceId)}
          />
        ) : undefined
      }
    />
  );

  const remove = agent?.remove;
  const agentTile = (agent: CallAgentView) => {
    const profile = agent.profile;
    return (
      <AgentTile
        key={agent.key}
        agent={agent}
        name={agent.mine ? agent.name : `${agent.name}, ${nameOf(agent.owner)}’s agent`}
        onRemove={profile && remove ? () => remove(profile.id) : undefined}
      />
    );
  };

  const sharer = people.find((person) => !person.self && person.sharing);
  const picked = people.find((person) => person.id === pinned);
  let focus: ReactNode;
  if (picked) focus = tile(picked, true);
  else if (sharer?.watching && sharer.screen)
    focus = (
      <CallTile
        name={`${label(sharer)}’s screen`}
        fit="contain"
        zoom={screenZoom}
        picture={<TrackVideo track={sharer.screen} self={false} />}
        actions={
          <>
            <ZoomControl
              value={`${Math.round(screenZoom * 100)}%`}
              canZoomOut={screenZoom > zoomLevels[0]}
              canZoomIn={screenZoom < zoomLevels[zoomLevels.length - 1]}
              onZoomOut={() =>
                setScreenZoom([...zoomLevels].reverse().find((level) => level < screenZoom) ?? 1)
              }
              onZoomIn={() =>
                setScreenZoom(zoomLevels.find((level) => level > screenZoom) ?? screenZoom)
              }
            >
              {zoomLevels.map((level) => (
                <MenuItem
                  key={level}
                  label={`${level * 100}%`}
                  onSelect={() => setScreenZoom(level)}
                />
              ))}
            </ZoomControl>
            <IconButton label="Stop watching" onClick={() => controls.watch(sharer.id, false)}>
              <EyeOff />
            </IconButton>
          </>
        }
      />
    );
  else if (sharer)
    focus = (
      <CallTile name={`${label(sharer)}’s screen`}>
        <div className="grid justify-items-center gap-3">
          <Face person={sharer} name={label(sharer)} />
          <Text size="meta" tone="muted">{`${label(sharer)} is sharing their screen`}</Text>
          <Button variant="primary" icon={Eye} onClick={() => controls.watch(sharer.id, true)}>
            Watch
          </Button>
        </div>
      </CallTile>
    );
  const rest = picked ? people.filter((person) => person.id !== picked.id) : people;
  const video = featured(people, pinned);
  const pictureInPicture =
    typeof document !== "undefined" && document.pictureInPictureEnabled && video
      ? () => {
          const element = playing.get(video);
          if (element) void element.requestPictureInPicture().catch(() => undefined);
        }
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <CallStage focus={focus} dimmed={controls.reconnecting}>
        {rest.map((person) => tile(person, false))}
        {(agent?.agents ?? []).map(agentTile)}
      </CallStage>
      {controls.captionsOn ? (
        <CallCaptions
          lines={controls.captions.map((line) => ({
            key: line.key,
            name:
              line.person === people.find((person) => person.self)?.id
                ? "You"
                : nameOf(line.person),
            text: line.text,
          }))}
        />
      ) : null}
      {agent?.rows}
      <CallBar>
        <CallControl
          label={controls.micOn ? "Mute" : "Unmute"}
          off={!controls.micOn}
          disabled={!live}
          onClick={controls.toggleMic}
          {...(controls.systemMic
            ? {}
            : {
                menuLabel: "Microphone settings",
                menuOpen: devicesOpen === "audio",
                onMenuOpenChange: (open: boolean) => setDevicesOpen(open ? "audio" : null),
                menu: <MicrophoneMenu audio={controls} onVoiceSettings={voiceSettings} />,
              })}
        >
          {controls.micOn ? <Mic /> : <MicOff />}
        </CallControl>
        <CallControl
          label={controls.deafened ? "Undeafen" : "Deafen"}
          off={controls.deafened}
          disabled={!live}
          onClick={controls.toggleDeafen}
          menuLabel="Sound settings"
          menuOpen={devicesOpen === "sound"}
          onMenuOpenChange={(open) => setDevicesOpen(open ? "sound" : null)}
          menu={<SpeakerMenu audio={controls} onVoiceSettings={voiceSettings} />}
        >
          {controls.deafened ? <HeadphoneOff /> : <Headphones />}
        </CallControl>
        {canShow ? (
          <>
            <CallControl
              label={controls.cameraOn ? "Turn camera off" : "Turn camera on"}
              off={!controls.cameraOn}
              disabled={!live}
              onClick={controls.toggleCamera}
              menuLabel="Cameras"
              menuOpen={devicesOpen === "camera"}
              onMenuOpenChange={(open) => setDevicesOpen(open ? "camera" : null)}
              menu={
                <DeviceChoices
                  kind="videoinput"
                  title="Camera"
                  value={controls.activeDevice("videoinput")}
                  onPick={(deviceId) => controls.pickDevice("videoinput", deviceId)}
                />
              }
            >
              {controls.cameraOn ? <Video /> : <VideoOff />}
            </CallControl>
            <IconButton
              label={controls.screenOn ? "Stop sharing" : "Share screen"}
              variant="secondary"
              aria-pressed={controls.screenOn}
              disabled={!live}
              onClick={controls.toggleScreen}
            >
              <MonitorUp />
            </IconButton>
          </>
        ) : null}
        {withPeople ? (
          <>
            <IconButton
              label={controls.handUp ? "Lower hand" : "Raise hand"}
              variant="secondary"
              aria-pressed={controls.handUp}
              disabled={!live}
              onClick={controls.toggleHand}
            >
              <Hand />
            </IconButton>
            <CallReactions reactions={callReactions} onPick={controls.react} disabled={!live} />
            <IconButton
              label={controls.captionsOn ? "Turn captions off" : "Turn captions on"}
              variant="secondary"
              aria-pressed={controls.captionsOn}
              disabled={!live}
              onClick={controls.toggleCaptions}
            >
              {controls.captionsOn ? <Captions /> : <CaptionsOff />}
            </IconButton>
          </>
        ) : null}
        {agent?.trigger}
        <ToolbarDivider />
        {pictureInPicture ? (
          <IconButton label="Picture in picture" onClick={pictureInPicture}>
            <PictureInPicture2 />
          </IconButton>
        ) : null}
        <IconButton
          label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={() => setFullscreen(!fullscreen)}
        >
          {fullscreen ? <Minimize /> : <Maximize />}
        </IconButton>
        <ToolbarDivider />
        <CallLeave onClick={controls.leave} />
      </CallBar>
    </div>
  );
}

const exitFullscreen = () => useCallSession.getState().setFullscreen(false);

export function CallFullscreen() {
  const fullscreen = useCallSession((state) => state.fullscreen);
  const where = useCallSession((state) => state.where);
  if (!fullscreen || !where) return null;
  return (
    <CallFullscreenFrame title={where.title} onExit={exitFullscreen}>
      <CallStageView />
    </CallFullscreenFrame>
  );
}

export function CallMiniPlayer() {
  const where = useCallSession((state) => state.where);
  const controls = useCallSession((state) => state.controls);
  const agent = useCallSession((state) => state.agent);
  const pinned = useCallSession((state) => state.pinned);
  const fullscreen = useCallSession((state) => state.fullscreen);
  const corner = useCallSession((state) => state.pipCorner);
  const location = useLocation();
  if (!where || !controls || fullscreen || where.isHome(location)) return null;
  const video = featured(controls.people, pinned);
  const other =
    controls.people.find((person) => !person.self && person.speaking) ??
    controls.people.find((person) => !person.self);
  const agentShown = agent?.agents.find((each) => each.profile);
  const self = controls.people.find((person) => person.self);
  let face: ReactNode = null;
  if (other) face = <Face person={other} name={other.name} />;
  else if (agentShown?.profile) face = <AgentAvatar agent={agentShown.profile} />;
  else if (self) face = <Face person={self} name={self.name} />;
  const picture = video ? (
    <TrackVideo track={video} self={false} />
  ) : face ? (
    <span>
      <span className="grid size-full place-items-center">{face}</span>
    </span>
  ) : (
    <span />
  );
  return (
    <div className="pointer-events-auto">
      <FloatingPip
        label="Call"
        picture={picture}
        caption={where.title}
        corner={corner}
        onCornerChange={useCallSession.getState().setPipCorner}
        onOpen={where.open}
        openLabel="Go back to the call"
        actions={
          <>
            <IconButton
              label={controls.micOn ? "Mute" : "Unmute"}
              aria-pressed={!controls.micOn}
              onClick={controls.toggleMic}
            >
              {controls.micOn ? <Mic /> : <MicOff />}
            </IconButton>
            <CallLeave onClick={controls.leave} />
          </>
        }
      />
    </div>
  );
}
