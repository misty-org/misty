import { BotMessageSquare, Workflow } from "lucide-react";
import { NavigatorToolDisclosure } from "./NavigatorToolDisclosure";

export function AgentsNavigatorDisclosure(props: {
  accountId: string;
  active: boolean;
  activeRoute: string;
  path: string;
}) {
  return (
    <NavigatorToolDisclosure
      accountId={props.accountId}
      appId="agents"
      label="Agents"
      path={props.path}
      active={props.active}
      activeDestination={props.active ? destinationFromRoute(props.activeRoute) : null}
      destinations={[
        {
          id: "chat",
          label: "Chat",
          icon: BotMessageSquare,
          path: props.path,
        },
        {
          id: "automations",
          label: "Automations",
          icon: Workflow,
          path: `${props.path}?view=automations`,
        },
      ]}
    />
  );
}

function destinationFromRoute(route: string): "chat" | "automations" {
  try {
    return new URL(route, "https://misty.local").searchParams.get("view") === "automations"
      ? "automations"
      : "chat";
  } catch {
    return "chat";
  }
}
