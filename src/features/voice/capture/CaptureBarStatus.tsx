import { Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, StateMark, Tooltip } from "@/shared/ui";
import { useCaptureStore } from "./useCaptureStore";

/**
 * The window's bottom bar item for a capture (Settings › Interface › Bottom bar): while one
 * records, how long it has gone, and a click that stops it. It draws nothing otherwise.
 */
export function CaptureBarStatus() {
  const phase = useCaptureStore((state) => state.phase);
  const live = phase === "live";
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) {
      setSince(null);
      return;
    }
    setSince(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  if (!live || since === null) return null;
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <Tooltip content="Stop recording">
      <Button
        variant="quiet"
        icon={<StateMark kind="working" label="Recording" />}
        iconEnd={Square}
        onClick={() => void useCaptureStore.getState().stop()}
      >
        {`Recording ${clock}`}
      </Button>
    </Tooltip>
  );
}
