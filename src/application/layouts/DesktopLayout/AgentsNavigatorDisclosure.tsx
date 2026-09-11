import { Activity } from "lucide-react";
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
      activeDestination={props.active ? "activity" : null}
      destinations={[{ id: "activity", label: "Activity", icon: Activity, path: props.path }]}
    />
  );
}
