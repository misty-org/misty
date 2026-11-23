import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Track } from "livekit-client";
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
  PhoneOff,
  PictureInPicture2,
  Video,
  VideoOff,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  CallBar,
  CallCaptions,
  CallControl,
  CallReactions,
  CallStage,
  CallTile,
  FloatingPip,
  IconButton,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
  Surface,
  Text,
  ToolbarDivider,
  ViewHeader,
  ViewportLayer,
  ZoomControl,
} from "@misty/ui";
import { AgentAvatar } from "@/features/agents";
import { useSpaceCan } from "@/features/spaces";
import { personTone } from "@/shared/lib/person_tone";
import { personInitials } from "@/shared/lib/person_initials";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallStore } from "./call_store";
import { callPath, useCallSession } from "./call_session_store";
import type { CallAgentView } from "./call_agents";
import type { CallPerson } from "./use_live_kit_call";
import { DeviceChoices, SpeakerChoices } from "./DeviceChoices";
import { callReactions } from "./call_signals";
import { CallPersonMenu } from "./CallPersonMenu";
import { featured, useCallTitle, useStableOrder } from "./call_stage_order";

const playing = new Map<Track, HTMLVideoElement>();

function TrackVideo({ track, self }: { track: Track; self: boolean }) {
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
  return (
    <Avatar size="lg" tone={personTone(person.id)}>
      <AvatarFallback>{personInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

const zoomLevels = [1, 1.5, 2, 3];

export function CallStageView() {
  const controls = useCallSession((state) => state.controls);
  const agent = useCallSession((state) => state.agent);
  const nameOf = useCallSession((state) => state.nameOf);
  const pinned = useCallSession((state) => state.pinned);
  const fullscreen = useCallSession((state) => state.fullscreen);
  const devicesOpen = useCallSession((state) => state.devicesOpen);
  const screenZoom = useCallSession((state) => state.screenZoom);
  const live = useCallStore((state) => state.active?.state === "live");
  const place = useCallStore((state) => state.active?.place);
  const moderator = useSpaceCan(place?.kind === "voice" ? place.spaceId : "", "members.remove");
  const everyone = controls?.people ?? [];
  const pickedNow = everyone.find((person) => person.id === pinned);
  const sharingNow = everyone.some((person) => !person.self && person.sharing);
  const ordered = useStableOrder(everyone, Boolean(pickedNow || sharingNow));
  if (!controls) return null;
  const people = ordered;
  const { pin, setFullscreen, setDevicesOpen, setScreenZoom } = useCallSession.getState();
  const label = (person: CallPerson) => (person.self ? "You" : nameOf(person.id));

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
      face={<Face person={person} name={label(person)} />}
      actions={
        people.length > 1 ? (
          <CallPersonMenu
            person={person}
            controls={controls}
            focused={focused}
            onFocus={() => pin(focused ? null : person.id)}
            moderator={moderator && place?.kind === "voice"}
          />
        ) : undefined
      }
    />
  );

  const remove = agent?.remove;
  const agentTile = (agent: CallAgentView) => {
    const name = agent.mine ? agent.name : `${agent.name}, ${nameOf(agent.owner)}’s agent`;
    return (
      <CallTile
        key={agent.key}
        name={name}
        speaking={agent.state === "speaking"}
        muted={agent.state === "working"}
        deafened={agent.state === "working"}
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
          agent.profile ? (
            <IconButton
              label={`Send ${agent.name} away`}
              onClick={() => agent.profile && remove?.(agent.profile.id)}
            >
              <LogOut />
            </IconButton>
          ) : undefined
        }
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
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
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
          menuLabel="Audio devices"
          menuOpen={devicesOpen === "audio"}
          onMenuOpenChange={(open) => setDevicesOpen(open ? "audio" : null)}
          menu={
            <>
              <DeviceChoices
                kind="audioinput"
                title="Microphone"
                value={controls.activeDevice("audioinput")}
                onPick={(deviceId) => controls.pickDevice("audioinput", deviceId)}
              />
              <SpeakerChoices
                value={controls.activeDevice("audiooutput")}
                onPick={(deviceId) => controls.pickDevice("audiooutput", deviceId)}
              />
              <MenuSeparator />
              <MenuCheckItem
                label="Noise reduction"
                checked={controls.noiseReduction}
                onCheckedChange={controls.setNoiseReduction}
              />
            </>
          }
        >
          {controls.micOn ? <Mic /> : <MicOff />}
        </CallControl>
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
        <IconButton
          label={controls.deafened ? "Undeafen" : "Deafen"}
          variant="secondary"
          aria-pressed={controls.deafened}
          disabled={!live}
          onClick={controls.toggleDeafen}
        >
          {controls.deafened ? <HeadphoneOff /> : <Headphones />}
        </IconButton>
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
        <IconButton label="Leave" variant="danger" onClick={controls.leave}>
          <PhoneOff />
        </IconButton>
      </CallBar>
    </div>
  );
}

function setWindowFullscreen(on: boolean) {
  if (!hasTauriInternals()) return;
  void getCurrentWindow()
    .setFullscreen(on)
    .catch(() => undefined);
}

export function CallFullscreen() {
  const fullscreen = useCallSession((state) => state.fullscreen);
  const active = useCallStore((state) => state.active);
  const title = useCallTitle(active);
  const windowFull = useRef(false);
  useEffect(() => {
    if (fullscreen === windowFull.current) return;
    windowFull.current = fullscreen;
    setWindowFullscreen(fullscreen);
  }, [fullscreen]);
  useEffect(
    () => () => {
      if (windowFull.current) setWindowFullscreen(false);
    },
    [],
  );
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") useCallSession.getState().setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  if (!fullscreen || !active) return null;
  return (
    <ViewportLayer layer="workspace-overlay">
      <Surface tone="page" className="flex size-full flex-col">
        <ViewHeader title={title} />
        <CallStageView />
      </Surface>
    </ViewportLayer>
  );
}

export function CallMiniPlayer() {
  const active = useCallStore((state) => state.active);
  const controls = useCallSession((state) => state.controls);
  const pinned = useCallSession((state) => state.pinned);
  const fullscreen = useCallSession((state) => state.fullscreen);
  const corner = useCallSession((state) => state.pipCorner);
  const title = useCallTitle(active);
  const location = useLocation();
  const navigate = useNavigate();
  if (!active || !controls || fullscreen) return null;
  const home = callPath(active);
  if (location.pathname === home || location.pathname.startsWith(`${home}/`)) return null;
  const video = featured(controls.people, pinned);
  const speaker =
    controls.people.find((person) => !person.self && person.speaking) ??
    controls.people.find((person) => !person.self) ??
    controls.people[0];
  const picture = video ? (
    <TrackVideo track={video} self={false} />
  ) : speaker ? (
    <span>
      <span className="grid size-full place-items-center">
        <Face person={speaker} name={speaker.name} />
      </span>
    </span>
  ) : (
    <span />
  );
  return (
    <div className="pointer-events-auto">
      <FloatingPip
        label="Call"
        picture={picture}
        caption={title}
        corner={corner}
        onCornerChange={useCallSession.getState().setPipCorner}
        onOpen={() => navigate(home)}
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
            <IconButton label="Leave" onClick={controls.leave}>
              <PhoneOff />
            </IconButton>
          </>
        }
      />
    </div>
  );
}
