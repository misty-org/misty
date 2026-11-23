import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isE2EESupported } from "livekit-client";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button, SideCard, Text, ViewportLayer, notify } from "@misty/ui";
import { useDirectUserId } from "../direct_account";
import { onRealtimeMessage } from "@/features/spaces";
import { dmPath, peekDm, useDms, useFriends } from "../direct_data";
import { isDoNotDisturb } from "../status_store";
import { deviceCallKey } from "./call_keys";
import { CallSession } from "./CallSession";
import { loopCallSound } from "./call_sounds";
import { CallFullscreen, CallMiniPlayer } from "./CallView";
import { watchSpeakerForSpeech } from "./call_devices";
import { dmOf, useCallStore } from "./call_store";
import { useMissedCalls } from "./missed_calls";

const RING_SECONDS = 30;

function readSealedKeys(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function IncomingCallHost() {
  useEffect(() => watchSpeakerForSpeech(), []);
  const myId = useDirectUserId();
  const incoming = useCallStore((state) => state.incoming);
  const active = useCallStore((state) => state.active);
  const maxPeople = useCallStore((state) => state.config?.max_people ?? 8);
  const dms = useDms().data;
  const friends = useFriends().data;
  const navigate = useNavigate();

  useEffect(() => {
    useCallStore.getState().loadConfig();
    if (isE2EESupported()) void deviceCallKey().catch(() => undefined);
  }, []);

  useEffect(
    () =>
      onRealtimeMessage("call", (message) => {
        const dmId = typeof message.dm_id === "string" ? message.dm_id : "";
        const from = typeof message.from === "string" ? message.from : "";
        if (!dmId) return;
        const store = useCallStore.getState();
        if (message.state === "ended") {
          if (store.incoming?.dmId === dmId) store.ring(null);
          return;
        }
        if (message.state === "declined") {
          const active = store.active;
          if (!active || dmOf(active) !== dmId || !active.caller || active.answered) return;
          const dm = peekDm(dmId);
          const name = dm?.members.find((member) => member.user_id === from)?.username ?? "They";
          notify({ message: `${name} declined the call.` });
          if (dm?.kind !== "group") store.leave();
          return;
        }
        if (message.state !== "ringing" || !from || from === myId) return;
        if (!isE2EESupported()) return;
        if (isDoNotDisturb()) {
          useMissedCalls
            .getState()
            .miss(dmId, { from, video: message.video === true, at: Date.now() });
          return;
        }
        store.ring({
          dmId,
          from,
          video: message.video === true,
          sealedKeys: readSealedKeys(message.sealed_keys),
        });
      }),
    [myId],
  );

  const ringing = Boolean(incoming);
  const waiting = Boolean(active?.caller && !active.answered);
  useEffect(() => (ringing ? loopCallSound("ring") : undefined), [ringing]);
  useEffect(() => (waiting ? loopCallSound("ringback") : undefined), [waiting]);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => {
      const call = useCallStore.getState().active;
      if (!call?.caller || call.answered) return;
      useCallStore.getState().leave();
      notify({ message: "No one answered." });
    }, RING_SECONDS * 1_000);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  useEffect(() => {
    if (!incoming) return;
    const timer = window.setTimeout(
      () => {
        if (useCallStore.getState().incoming !== incoming) return;
        useCallStore.getState().ring(null);
        useMissedCalls
          .getState()
          .miss(incoming.dmId, { from: incoming.from, video: incoming.video, at: Date.now() });
      },
      (RING_SECONDS + 5) * 1_000,
    );
    return () => window.clearTimeout(timer);
  }, [incoming]);

  const callerName = incoming
    ? (dms
        ?.find((dm) => dm.id === incoming.dmId)
        ?.members.find((member) => member.user_id === incoming.from)?.username ??
      friends?.friends.find((friend) => friend.user_id === incoming.from)?.username ??
      "Someone")
    : "";

  if (!incoming && !active) return null;
  return (
    <>
      {active ? <CallSession key={active.room} call={active} maxPeople={maxPeople} /> : null}
      <CallFullscreen />
      <ViewportLayer layer="chrome" passthrough>
        <CallMiniPlayer />
        <div className="absolute top-12 right-0 flex flex-col items-end">
          {incoming ? (
            <SideCard label="Incoming call" className="pointer-events-auto">
              <div className="grid gap-3 p-3">
                <Text size="control" weight="semibold" tone="bright">
                  {`${callerName} is calling`}
                </Text>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="quiet"
                    icon={PhoneOff}
                    onClick={() => useCallStore.getState().decline()}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="primary"
                    icon={incoming.video ? Video : Phone}
                    disabled={Boolean(active)}
                    onClick={() => {
                      const dmId = incoming.dmId;
                      void useCallStore
                        .getState()
                        .accept()
                        .then(() => {
                          if (dmOf(useCallStore.getState().active) === dmId) navigate(dmPath(dmId));
                        });
                    }}
                  >
                    Accept
                  </Button>
                </div>
              </div>
            </SideCard>
          ) : null}
        </div>
      </ViewportLayer>
    </>
  );
}
