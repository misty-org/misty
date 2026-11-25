import { Mic, MicOff } from "lucide-react";
import { CallLeave, IconButton, Pressable, Separator, StateMark, Text } from "@misty/ui";
import { useCallSession } from "./call_session_store";

export function CallDock() {
  const where = useCallSession((state) => state.where);
  const controls = useCallSession((state) => state.controls);
  if (!where || !controls) return null;
  const waiting = controls.reconnecting || !where.live;
  const status = controls.reconnecting ? "Reconnecting" : where.live ? "In the call" : "Connecting";
  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-2 pt-1" data-sidebar>
      <Separator className="-mx-3 w-auto" />
      <div className="flex min-w-0 items-center gap-1">
        <Pressable
          wash="row"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left"
          onClick={where.open}
        >
          <StateMark kind={waiting ? "waiting" : "online"} label={status} />
          <span className="grid min-w-0">
            <Text size="meta" tone="bright" weight="medium">
              {status}
            </Text>
            <Text size="caption" tone="muted">
              {where.title}
            </Text>
          </span>
        </Pressable>
        <IconButton label={controls.micOn ? "Mute" : "Unmute"} onClick={controls.toggleMic}>
          {controls.micOn ? <Mic /> : <MicOff />}
        </IconButton>
        <CallLeave onClick={controls.leave} />
      </div>
    </div>
  );
}
