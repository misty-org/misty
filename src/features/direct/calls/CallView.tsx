import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Track } from "livekit-client";
import {
  Eye,
  EyeOff,
  LogOut,
  Maximize,
  Maximize2,
  Mic,
  MicOff,
  Minimize,
  Minimize2,
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
  CallStage,
  CallTile,
  FloatingPip,
  IconButton,
  Surface,
  Text,
  ToolbarDivider,
  ViewHeader,
  ViewportLayer,
} from "@misty/ui";
import { AgentAvatar } from "@/features/agents";
import { personTone } from "@/shared/lib/personTone";
import { personInitials } from "@/shared/lib/personInitials";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallStore, type ActiveCall } from "./callStore";
import { callPath, useCallSession } from "./callSessionStore";
import type { CallAgentView } from "./callAgents";
import type { CallPerson } from "./useLiveKitCall";

/** Every video playing now, by its track, so the call's featured one can go picture in picture. */
const playing = new Map<Track, HTMLVideoElement>();

/** A camera or a shared screen. Its sound plays at the window's root (`CallSession`). */
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

/** What the call is called: its voice channel, else who else is in it. */
function useCallTitle(call: ActiveCall | null): string {
  const people = useCallSession((state) => state.controls?.people);
  const nameOf = useCallSession((state) => state.nameOf);
  if (!call) return "";
  if (call.place.kind === "voice") return call.place.name;
  const others = (people ?? []).filter((person) => !person.self);
  return others.length ? others.map((person) => nameOf(person.id)).join(", ") : "Call";
}

/** The picture the call is about now: a watched screen, a picked person, else someone's camera. */
function featured(people: CallPerson[], pinned: string | null): Track | undefined {
  const pick = people.find((person) => person.id === pinned);
  const screen = people.find((person) => !person.self && person.screen);
  return (
    pick?.screen ??
    pick?.camera ??
    screen?.screen ??
    people.find((person) => !person.self && person.camera)?.camera ??
    people.find((person) => person.self)?.camera
  );
}

/**
 * The call this window is in, in full: everyone's tile on the stage (a shared screen, or the person
 * picked, large with the rest beside it), then the call's controls. It fills its parent, so a voice
 * channel's page, a DM and full screen all draw it the same way. A screen someone shares is received
 * only once Watch is pressed.
 */
export function CallStageView() {
  const controls = useCallSession((state) => state.controls);
  const agent = useCallSession((state) => state.agent);
  const nameOf = useCallSession((state) => state.nameOf);
  const pinned = useCallSession((state) => state.pinned);
  const fullscreen = useCallSession((state) => state.fullscreen);
  const live = useCallStore((state) => state.active?.state === "live");
  if (!controls) return null;
  const { people } = controls;
  const { pin, setFullscreen } = useCallSession.getState();
  const label = (person: CallPerson) => (person.self ? "You" : nameOf(person.id));

  const tile = (person: CallPerson, focused: boolean) => (
    <CallTile
      key={person.id}
      name={label(person)}
      speaking={person.speaking}
      muted={!person.micOn}
      picture={person.camera ? <TrackVideo track={person.camera} self={person.self} /> : undefined}
      face={<Face person={person} name={label(person)} />}
      actions={
        people.length > 1 ? (
          focused ? (
            <IconButton label="Show everyone" onClick={() => pin(null)}>
              <Minimize2 />
            </IconButton>
          ) : (
            <IconButton label="Focus" onClick={() => pin(person.id)}>
              <Maximize2 />
            </IconButton>
          )
        ) : undefined
      }
    />
  );

  // An agent's tile: its own picture for this person's agents, else its initials, ringed while it
  // speaks. Only this person's own agents can be sent away from here.
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

  // Someone else's screen comes first; the person picked replaces it.
  const sharer = people.find((person) => !person.self && person.sharing);
  const picked = people.find((person) => person.id === pinned);
  let focus: ReactNode;
  if (picked) focus = tile(picked, true);
  else if (sharer?.watching && sharer.screen)
    focus = (
      <CallTile
        name={`${label(sharer)}’s screen`}
        fit="contain"
        picture={<TrackVideo track={sharer.screen} self={false} />}
        actions={
          <IconButton label="Stop watching" onClick={() => controls.watch(sharer.id, false)}>
            <EyeOff />
          </IconButton>
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
      <CallStage focus={focus}>
        {rest.map((person) => tile(person, false))}
        {(agent?.agents ?? []).map(agentTile)}
      </CallStage>
      {agent?.rows}
      <CallBar>
        <IconButton
          label={controls.micOn ? "Mute" : "Unmute"}
          variant="secondary"
          aria-pressed={!controls.micOn}
          disabled={!live}
          onClick={controls.toggleMic}
        >
          {controls.micOn ? <Mic /> : <MicOff />}
        </IconButton>
        <IconButton
          label={controls.cameraOn ? "Turn camera off" : "Turn camera on"}
          variant="secondary"
          aria-pressed={controls.cameraOn}
          disabled={!live}
          onClick={controls.toggleCamera}
        >
          {controls.cameraOn ? <Video /> : <VideoOff />}
        </IconButton>
        <IconButton
          label={controls.screenOn ? "Stop sharing" : "Share screen"}
          variant="secondary"
          aria-pressed={controls.screenOn}
          disabled={!live}
          onClick={controls.toggleScreen}
        >
          <MonitorUp />
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
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(on))
    .catch(() => undefined);
}

/**
 * The call over the whole window, and the window over the whole screen, while full screen is on.
 * Escape, or the bar's button, puts both back.
 */
export function CallFullscreen() {
  const fullscreen = useCallSession((state) => state.fullscreen);
  const active = useCallStore((state) => state.active);
  const title = useCallTitle(active);
  // The window follows the call into full screen and back out, and only then: a window the person
  // made full screen themselves stays as it is when a call starts.
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

/**
 * The call in a corner of the window while the person is elsewhere in it: whoever matters now (a
 * watched screen, the person picked, else a camera), or their face. A press goes back to the call;
 * Mute and Leave show on hover. It hides on the call's own page and while it is full screen.
 */
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
    // The frame makes its picture a block; the face is centered inside it.
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
