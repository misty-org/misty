import { useEffect } from "react";
import { Phone, Video } from "lucide-react";
import { Button, IconButton } from "@misty/ui";
import { useCallStore, useCallsAvailable } from "./callStore";

/**
 * Voice call and Video call in a DM's bar. They show only once the server offers calls and this
 * computer can encrypt them end to end; starting one rings the DM's other people, then joins.
 */
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

/** Call, as a button under a DM's opening: a voice call, shown only where calls can be made. */
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
