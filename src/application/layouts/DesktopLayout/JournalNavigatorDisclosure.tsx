import { rememberedJournalRoute } from "@/features/spaces";
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
      path: rememberedJournalRoute(props.accountId, props.spaceId, "notes"),
    },
    {
      id: "drawings" as const,
      label: "Drawings",
      icon: DrawingsDestinationIcon,
      path: rememberedJournalRoute(props.accountId, props.spaceId, "drawings"),
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
    return new URL(route, "https://misty.local").pathname.split("/").filter(Boolean)[2] ===
      "drawings"
      ? "drawings"
      : "notes";
  } catch {
    return "notes";
  }
}
