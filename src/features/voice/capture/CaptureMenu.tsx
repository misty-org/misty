import { AudioLines, Mic, MonitorPlay, MonitorSpeaker } from "lucide-react";
import { publicBetaFeatureEnabled } from "@/features/launch";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { captureMicrophone, captureScreen, captureSystemAudio } from "./startCapture";
import { useCaptureStore } from "./useCaptureStore";

/** "Capture" beside New note: listen and turn what's said into a Note. */
export function CaptureMenu() {
  const phase = useCaptureStore((state) => state.phase);
  if (!publicBetaFeatureEnabled("voiceNotes") || !hasTauriInternals()) return null;
  const busy = phase !== "idle" && phase !== "done";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="px-3" disabled={busy}>
          <AudioLines />
          Capture
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => void captureMicrophone()}>
          <Mic /> Microphone
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void captureSystemAudio()}>
          <MonitorSpeaker /> System audio
        </DropdownMenuItem>
        {publicBetaFeatureEnabled("captureSessions") && (
          <DropdownMenuItem onSelect={() => void captureScreen()}>
            <MonitorPlay /> Screen recording
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
