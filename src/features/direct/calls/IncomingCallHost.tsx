import { useEffect } from "react";
import { isE2EESupported } from "livekit-client";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button, SideCard, Text, ViewportLayer, notify } from "@misty/ui";
import { useDirectUserId } from "../directAccount";
import { onRealtimeMessage } from "@/features/spaces";
import { peekDm, useDms, useFriends } from "../directData";
import { isDoNotDisturb } from "../statusStore";
import { deviceCallKey } from "./callKeys";
import { CallPanel } from "./CallPanel";
import { dmOf, useCallStore } from "./callStore";
import { useMissedCalls } from "./missedCalls";

function readSealedKeys(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * Calls for the signed-in account, mounted once at the window's root: it publishes this computer's
 * call key so others can seal a call's key for it, shows a ring from someone in a DM ("Ana is
 * calling", with Accept and Decline) unless Do not disturb is on, and holds the call panel while a
 * call is on. A ring missed during Do not disturb isn't kept.
 */
export function IncomingCallHost() {
  const myId = useDirectUserId();
  const incoming = useCallStore((state) => state.incoming);
  const active = useCallStore((state) => state.active);
  const maxPeople = useCallStore((state) => state.config?.max_people ?? 8);
  const dms = useDms().data;
  const friends = useFriends().data;

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
          // Only the caller, still waiting for an answer, hears of it; a one-to-one call ends.
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
        // Do not disturb never rings: the call shows as missed in its DM instead.
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

  const callerName = incoming
    ? (dms
        ?.find((dm) => dm.id === incoming.dmId)
        ?.members.find((member) => member.user_id === incoming.from)?.username ??
      friends?.friends.find((friend) => friend.user_id === incoming.from)?.username ??
      "Someone")
    : "";

  if (!incoming && !active) return null;
  return (
    <ViewportLayer layer="chrome" passthrough>
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
                  onClick={() => void useCallStore.getState().accept()}
                >
                  Accept
                </Button>
              </div>
            </div>
          </SideCard>
        ) : null}
        {active ? <CallPanel key={active.room} call={active} maxPeople={maxPeople} /> : null}
      </div>
    </ViewportLayer>
  );
}
