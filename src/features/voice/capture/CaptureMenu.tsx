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
import { captureMicrophone, captureSystemAudio } from "./start_capture";
import { useCaptureStore } from "./use_capture_store";

export function CaptureMenu() {
  const phase = useCaptureStore((state) => state.phase);
  const speech = useSpeechSupport();
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
