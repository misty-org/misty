import { Play, Square } from "lucide-react";
import { useScreenCaptureStore } from "@/features/screen-memory";
import { Button } from "@/shared/ui";

/**
 * Starts and stops a capture session, at the left of the tree. A session reads the window in
 * front until you stop it, and the new screen moments grow into the tree. It is hidden where the
 * system can't capture.
 */
export function CaptureControl() {
  const supported = useScreenCaptureStore((s) => s.supported);
  const running = useScreenCaptureStore((s) => s.running);
  const frames = useScreenCaptureStore((s) => s.frames);
  const notice = useScreenCaptureStore((s) => s.notice);
  if (!supported && !notice) return null;
  const { start, stop } = useScreenCaptureStore.getState();
  return (
    <div className="absolute left-3 top-3 z-10 flex max-w-60 flex-col items-start gap-1.5">
      {supported && (
        <Button
          size="sm"
          variant="outline"
          aria-pressed={running}
          onClick={() => void (running ? stop() : start())}
        >
          {running ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
          {running ? "Stop capture" : "Start capture"}
        </Button>
      )}
      {running && (
        <p role="status" className="m-0 px-1 text-xs text-cream-muted">
          Capturing · {frames.toLocaleString()} {frames === 1 ? "screen" : "screens"}
        </p>
      )}
      {notice && (
        <p role="status" className="m-0 px-1 text-xs leading-4 text-cream-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
