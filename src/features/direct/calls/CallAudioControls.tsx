import { Headphones, HeadphoneOff, Mic, MicOff, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SplitButton,
} from "@misty/ui";
import { DeviceChoices } from "./DeviceChoices";
import {
  rememberSpeaker,
  savedCallAudio,
  savedCallDevice,
  savedNoiseReduction,
} from "./call_devices";
import { useCallStore } from "./call_store";

function useCallAudio() {
  const live = useCallStore((state) => state.audio);
  const saved = savedCallAudio((state) => state.value);
  const noiseReduction = savedNoiseReduction((state) => state.value);
  const microphone = savedCallDevice.audioinput((state) => state.value);
  const speaker = savedCallDevice.audiooutput((state) => state.value);
  if (live) return live;
  return {
    micOn: !saved.muted && !saved.deafened,
    deafened: saved.deafened,
    noiseReduction,
    toggleMic: () =>
      savedCallAudio
        .getState()
        .set((current) =>
          current.deafened
            ? { muted: false, deafened: false }
            : { ...current, muted: !current.muted },
        ),
    toggleDeafen: () =>
      savedCallAudio.getState().set((current) => ({ ...current, deafened: !current.deafened })),
    setNoiseReduction: (on: boolean) => savedNoiseReduction.getState().set(on),
    activeDevice: (kind: "audioinput" | "audiooutput") =>
      kind === "audioinput" ? microphone : speaker,
    pickDevice: (kind: "audioinput" | "audiooutput", deviceId: string) => {
      if (kind === "audiooutput") void rememberSpeaker(deviceId);
      else savedCallDevice.audioinput.getState().set(deviceId);
    },
  };
}

export function CallAudioControls({ onVoiceSettings }: { onVoiceSettings(): void }) {
  const audio = useCallAudio();
  return (
    <>
      <SplitButton label="Microphone">
        <IconButton
          label={audio.micOn ? "Mute" : "Unmute"}
          aria-pressed={!audio.micOn}
          onClick={audio.toggleMic}
        >
          {audio.micOn ? <Mic /> : <MicOff />}
        </IconButton>
        <DropdownMenu modal={false}>
          <MenuTrigger iconOnly chevron label="Microphone settings" />
          <DropdownMenuContent side="top" align="start">
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
            <MenuItem icon={Settings2} label="Voice settings" onSelect={onVoiceSettings} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SplitButton>
      <SplitButton label="Sound">
        <IconButton
          label={audio.deafened ? "Undeafen" : "Deafen"}
          aria-pressed={audio.deafened}
          onClick={audio.toggleDeafen}
        >
          {audio.deafened ? <HeadphoneOff /> : <Headphones />}
        </IconButton>
        <DropdownMenu modal={false}>
          <MenuTrigger iconOnly chevron label="Sound settings" />
          <DropdownMenuContent side="top" align="start">
            <DeviceChoices
              kind="audiooutput"
              title="Speaker"
              value={audio.activeDevice("audiooutput")}
              onPick={(deviceId) => audio.pickDevice("audiooutput", deviceId)}
            />
            <MenuSeparator />
            <MenuItem icon={Settings2} label="Voice settings" onSelect={onVoiceSettings} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SplitButton>
    </>
  );
}
