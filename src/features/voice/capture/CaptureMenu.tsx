import { AudioLines, Mic, MonitorSpeaker } from "lucide-react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
} from "@misty/ui";
import { useSpeechSupport } from "../speech";
import { captureMicrophone, captureSystemAudio } from "./startCapture";
import { useCaptureStore } from "./useCaptureStore";

/** "Listen" beside New note: hear what's said and turn it into a Note. */
export function CaptureMenu() {
  const phase = useCaptureStore((state) => state.phase);
  const speech = useSpeechSupport();
  // What's heard is recognized by this computer; where it can't, there's nothing to listen with.
  if (!hasTauriInternals() || !speech?.recognition) return null;
  const busy = phase !== "idle" && phase !== "done";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="quiet" icon={AudioLines} disabled={busy}>
          Listen
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <MenuItem icon={Mic} label="Microphone" onSelect={() => void captureMicrophone()} />
        <MenuItem
          icon={MonitorSpeaker}
          label="System audio"
          onSelect={() => void captureSystemAudio()}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
