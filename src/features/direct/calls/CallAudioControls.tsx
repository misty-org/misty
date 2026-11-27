import { Headphones, HeadphoneOff, Mic, MicOff, Settings2 } from "lucide-react";
import { CallControl, MenuCheckItem, MenuItem, MenuSeparator } from "@misty/ui";
import { DeviceChoices } from "./DeviceChoices";
import {
  rememberSpeaker,
  useSavedCallAudio,
  savedCallDevice,
  useSavedNoiseReduction,
  useSavedSpeaker,
} from "./call_devices";
import { useSavedInputDevice } from "@/features/voice";
import { useCallStore, type LiveCallAudio } from "./call_store";

type AudioDevices = Pick<
  LiveCallAudio,
  "noiseReduction" | "setNoiseReduction" | "activeDevice" | "pickDevice"
>;

export function useCallAudio(): LiveCallAudio {
  const live = useCallStore((state) => state.audio);
  const saved = useSavedCallAudio((state) => state.value);
  const noiseReduction = useSavedNoiseReduction((state) => state.value);
  const microphone = useSavedInputDevice((state) => state.value);
  const speaker = useSavedSpeaker((state) => state.value);
  if (live) return live;
  return {
    micOn: !saved.muted,
    deafened: saved.deafened,
    noiseReduction,
    toggleMic: () =>
      useSavedCallAudio.getState().set((current) => ({ ...current, muted: !current.muted })),
    toggleDeafen: () =>
      useSavedCallAudio.getState().set((current) => ({ ...current, deafened: !current.deafened })),
    setNoiseReduction: (on: boolean) => useSavedNoiseReduction.getState().set(on),
    activeDevice: (kind: "audioinput" | "audiooutput") =>
      kind === "audioinput" ? microphone : speaker,
    pickDevice: (kind: "audioinput" | "audiooutput", deviceId: string) => {
      if (kind === "audiooutput") void rememberSpeaker(deviceId);
      else savedCallDevice.audioinput.getState().set(deviceId);
    },
  };
}

export function MicrophoneMenu({
  audio,
  onVoiceSettings,
}: {
  audio: AudioDevices;
  onVoiceSettings?: () => void;
}) {
  return (
    <>
      <DeviceChoices
        kind="audioinput"
        title="Microphone"
        value={audio.activeDevice("audioinput")}
        onPick={(deviceId) => audio.pickDevice("audioinput", deviceId)}
      />
      <MenuSeparator />
      <MenuCheckItem
        label="Noise reduction"
        checked={audio.noiseReduction}
        onCheckedChange={audio.setNoiseReduction}
      />
      {onVoiceSettings ? (
        <MenuItem icon={Settings2} label="Voice settings" onSelect={onVoiceSettings} />
      ) : null}
    </>
  );
}

export function SpeakerMenu({
  audio,
  onVoiceSettings,
}: {
  audio: AudioDevices;
  onVoiceSettings?: () => void;
}) {
  return (
    <>
      <DeviceChoices
        kind="audiooutput"
        title="Speaker"
        value={audio.activeDevice("audiooutput")}
        onPick={(deviceId) => audio.pickDevice("audiooutput", deviceId)}
      />
      {onVoiceSettings ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Settings2} label="Voice settings" onSelect={onVoiceSettings} />
        </>
      ) : null}
    </>
  );
}

export function CallAudioControls({ onVoiceSettings }: { onVoiceSettings(): void }) {
  const audio = useCallAudio();
  return (
    <>
      <CallControl
        label={audio.micOn ? "Mute" : "Unmute"}
        off={!audio.micOn}
        onClick={audio.toggleMic}
        menuLabel="Microphone settings"
        menu={<MicrophoneMenu audio={audio} onVoiceSettings={onVoiceSettings} />}
      >
        {audio.micOn ? <Mic /> : <MicOff />}
      </CallControl>
      <CallControl
        label={audio.deafened ? "Undeafen" : "Deafen"}
        off={audio.deafened}
        onClick={audio.toggleDeafen}
        menuLabel="Sound settings"
        menu={<SpeakerMenu audio={audio} onVoiceSettings={onVoiceSettings} />}
      >
        {audio.deafened ? <HeadphoneOff /> : <Headphones />}
      </CallControl>
    </>
  );
}
