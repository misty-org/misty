import { DrawingsDestinationIcon, NotesDestinationIcon } from "./NavigatorDestinationIcons";
import { NavigatorToolDisclosure } from "./NavigatorToolDisclosure";

type JournalDestinationId = "notes" | "drawings";

export function JournalNavigatorDisclosure(props: {
  accountId: string;
  spaceId: string;
  active: boolean;
  activeRoute: string;
  path: string;
}) {
  const destinations = [
    {
      id: "notes" as const,
      label: "Notes",
      icon: NotesDestinationIcon,
      path: appView(props.path, "notes"),
    },
    {
      id: "drawings" as const,
      label: "Drawings",
      icon: DrawingsDestinationIcon,
      path: appView(props.path, "drawings"),
    },
  ];

  return (
    <NavigatorToolDisclosure
      accountId={props.accountId}
      appId="journal"
      label="Journal"
      path={props.path}
      active={props.active}
      activeDestination={props.active ? journalDestinationFromRoute(props.activeRoute) : null}
      destinations={destinations}
    />
  );
}

function journalDestinationFromRoute(route: string): JournalDestinationId {
  try {
    return new URL(route, "https://misty.local").searchParams.get("view") === "drawings"
      ? "drawings"
      : "notes";
  } catch {
    return "notes";
  }
}

function appView(route: string, view: JournalDestinationId) {
  const url = new URL(route, "https://misty.local");
  url.searchParams.set("view", view);
  return `${url.pathname}${url.search}`;
}
