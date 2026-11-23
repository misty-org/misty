import { Mic, MicOff, PhoneOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { IconButton, Pressable, StateMark, Text } from "@misty/ui";
import { useCallStore } from "./call_store";
import { callPath, useCallSession } from "./call_session_store";

export function CallDock() {
  const navigate = useNavigate();
  const active = useCallStore((state) => state.active);
  const controls = useCallSession((state) => state.controls);
  const nameOf = useCallSession((state) => state.nameOf);
  if (!active || !controls) return null;
  const reconnecting = controls.reconnecting;
  const live = active.state === "live";
  const where =
    active.place.kind === "voice"
      ? active.place.name
      : controls.people
          .filter((person) => !person.self)
          .map((person) => nameOf(person.id))
          .join(", ") || "Direct call";
  const status = reconnecting ? "Reconnecting" : live ? "In the call" : "Connecting";
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 pt-1" data-sidebar>
      <Pressable
        wash="row"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left"
        onClick={() => navigate(callPath(active))}
      >
        <StateMark kind={reconnecting || !live ? "waiting" : "online"} label={status} />
        <span className="grid min-w-0">
          <Text size="meta" tone="bright" weight="medium">
            {status}
          </Text>
          <Text size="caption" tone="muted">
            {where}
          </Text>
        </span>
      </Pressable>
      <IconButton label={controls.micOn ? "Mute" : "Unmute"} onClick={controls.toggleMic}>
        {controls.micOn ? <Mic /> : <MicOff />}
      </IconButton>
      <IconButton label="Leave" onClick={controls.leave}>
        <PhoneOff />
      </IconButton>
    </div>
  );
}
