import { AudioLines, Mic, MonitorSpeaker } from "lucide-react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
} from "@/shared/ui";
import { captureMicrophone, captureSystemAudio } from "./startCapture";
import { useCaptureStore } from "./useCaptureStore";

/** "Listen" beside New note: hear what's said and turn it into a Note. */
export function CaptureMenu() {
  const phase = useCaptureStore((state) => state.phase);
  if (!hasTauriInternals()) return null;
  const busy = phase !== "idle" && phase !== "done";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="quiet" icon={AudioLines} className="px-3" disabled={busy}>
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
