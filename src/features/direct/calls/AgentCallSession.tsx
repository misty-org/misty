import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CircleStop } from "lucide-react";
import { IconButton } from "@misty/ui";
import { useUserStore } from "@/features/account";
import { openAgentThread } from "@/features/agents";
import { useCallAudio } from "./CallAudioControls";
import { savedCallDevice } from "./call_devices";
import { useCallSession } from "./call_session_store";
import { useCallShortcuts } from "./use_call_shortcuts";
import type { CallControls, CallPerson, CallVideo } from "./use_live_kit_call";
import type { CallAgentPart } from "./UseCallAgent";
import type { LocalAgentCall } from "./local_agent_call";

const noBaseKey = new Uint8Array(0);
const nothing = () => undefined;

function streamVideo(stream: MediaStream): CallVideo {
  return {
    attach: (element) => {
      element.muted = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    },
    detach: (element) => {
      if (element.srcObject === stream) element.srcObject = null;
    },
  };
}

export function AgentCallSession({ call }: { call: LocalAgentCall }) {
  const view = useSyncExternalStore(call.subscribe, call.current, call.current);
  const me = useUserStore((state) => state.me);
  const audio = useCallAudio();
  const camera = savedCallDevice.videoinput((state) => state.value);
  const cameraVideo = useMemo(
    () => (view.camera ? streamVideo(view.camera) : undefined),
    [view.camera],
  );
  const live = view.state !== "connecting";
  const answering =
    view.state === "thinking" || view.state === "working" || view.state === "speaking";
  const selfId = me?.id ?? "me";
  const name = call.agent.name;

  const self: CallPerson = {
    id: selfId,
    name: "You",
    self: true,
    speaking: view.hearing,
    micOn: view.micOn,
    camera: cameraVideo,
    sharing: false,
    watching: false,
    weak: false,
    hand: false,
    deafened: view.deafened,
    volume: 1,
    audio: [],
  };

  const controls: CallControls = {
    room: null,
    people: [self],
    baseKey: noBaseKey,
    micOn: view.micOn,
    cameraOn: Boolean(view.camera),
    screenOn: Boolean(view.screen),
    reconnecting: false,
    deafened: view.deafened,
    handUp: false,
    noiseReduction: audio.noiseReduction,
    silentMic: false,
    systemMic: true,
    captionsOn: false,
    captions: [],
    offerLowerHand: false,
    toggleDeafen: call.toggleDeafen,
    toggleHand: nothing,
    toggleCaptions: nothing,
    lowerHandOf: nothing,
    moderate: nothing,
    react: nothing,
    setNoiseReduction: audio.setNoiseReduction,
    setVolume: nothing,
    activeDevice: (kind) => (kind === "videoinput" ? camera : audio.activeDevice(kind)),
    pickDevice: (kind, deviceId) => {
      if (kind === "videoinput") savedCallDevice.videoinput.getState().set(deviceId);
      else audio.pickDevice(kind, deviceId);
    },
    toggleMic: call.toggleMic,
    toggleCamera: () => void call.toggleCamera(),
    toggleScreen: () => void call.toggleScreen(),
    watch: nothing,
    leave: call.end,
  };

  const agent: CallAgentPart = {
    rows: null,
    trigger: (
      <IconButton
        label={`Stop ${name}`}
        variant="secondary"
        disabled={!answering}
        onClick={call.stopTurn}
      >
        <CircleStop />
      </IconButton>
    ),
    agents: [
      {
        key: call.agent.id,
        name,
        owner: selfId,
        mine: true,
        state: view.state === "connecting" ? "listening" : view.state,
        profile: call.agent,
        conversationId: call.conversationId,
      },
    ],
  };

  useCallShortcuts(controls, live);

  useEffect(() => {
    useCallSession.getState().publish({
      where: {
        kind: "agent",
        title: name,
        live,
        canShow: call.sees,
        open: () => openAgentThread(call.agent.id, call.conversationId),
        isHome: ({ pathname, search }) =>
          pathname === "/agents" &&
          new URLSearchParams(search).get("conversation") === call.conversationId,
      },
      controls,
      agent,
      nameOf: (userId) => (userId === selfId ? (me?.username ?? "You") : name),
      faceOf: (userId) => (me && me.id === userId ? me : undefined),
    });
  });
  useEffect(() => () => useCallSession.getState().clear(), []);
  return null;
}
