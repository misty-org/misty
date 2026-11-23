import { Server } from "lucide-react";
import { currentApiBase, isMistyCloud, useServerChoice } from "@/api/deployment/server_choice";
import { useSpacesConnection } from "@/features/spaces";
import { openSettings } from "@/features/settings";
import { Button, StateMark } from "@misty/ui";

function useServerName(): string {
  const choice = useServerChoice((state) => state.choice);
  const base = choice ? (choice.mode === "server" ? choice.url : "") : currentApiBase();
  if (!base) return "";
  if (isMistyCloud(choice)) return "Misty Cloud";
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

export function ServerStatus() {
  const name = useServerName();
  const connection = useSpacesConnection((state) => state.state);
  if (!name) return null;
  const mark =
    connection === "connected"
      ? "online"
      : connection === "reconnecting"
        ? "waiting"
        : connection === "connecting"
          ? "working"
          : null;
  return (
    <Button
      variant="quiet"
      icon={mark ? <StateMark kind={mark} label={markLabel[mark]} /> : Server}
      onClick={() => openSettings("server")}
    >
      {connection === "reconnecting" ? `Reconnecting to ${name}` : name}
    </Button>
  );
}

const markLabel = { online: "Connected", waiting: "Reconnecting", working: "Connecting" } as const;

export function ConnectionProblem() {
  const name = useServerName();
  const connection = useSpacesConnection((state) => state.state);
  if (!name || connection !== "reconnecting") return null;
  return (
    <Button
      variant="quiet"
      icon={<StateMark kind="waiting" label="Reconnecting" />}
      onClick={() => openSettings("server")}
    >
      {`Can't reach ${name}`}
    </Button>
  );
}
