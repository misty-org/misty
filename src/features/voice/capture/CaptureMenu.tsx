import { AudioLines, Mic, MonitorSpeaker } from "lucide-react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
        <Button variant="ghost" className="px-3" disabled={busy}>
          <AudioLines />
          Listen
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => void captureMicrophone()}>
          <Mic /> Microphone
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void captureSystemAudio()}>
          <MonitorSpeaker /> System audio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
