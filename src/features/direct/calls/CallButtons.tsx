import { useEffect } from "react";
import { Phone, Video } from "lucide-react";
import { Button, IconButton } from "@misty/ui";
import { useCallStore, useCallsAvailable } from "./call_store";

export function CallButtons({ dmId }: { dmId: string }) {
  const available = useCallsAvailable();
  const inCall = useCallStore((state) => Boolean(state.active));
  useEffect(() => useCallStore.getState().loadConfig(), []);
  if (!available) return null;
  const start = (video: boolean) => void useCallStore.getState().start(dmId, video);
  return (
    <>
      <IconButton label="Voice call" disabled={inCall} onClick={() => start(false)}>
        <Phone />
      </IconButton>
      <IconButton label="Video call" disabled={inCall} onClick={() => start(true)}>
        <Video />
      </IconButton>
    </>
  );
}

export function CallButton({ dmId }: { dmId: string }) {
  const available = useCallsAvailable();
  const inCall = useCallStore((state) => Boolean(state.active));
  if (!available) return null;
  return (
    <Button
      icon={Phone}
      disabled={inCall}
      onClick={() => void useCallStore.getState().start(dmId, false)}
    >
      Call
    </Button>
  );
}
