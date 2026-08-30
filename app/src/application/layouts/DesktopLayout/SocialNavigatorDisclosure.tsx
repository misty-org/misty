import {
  InstagramBrandIcon,
  MessengerBrandIcon,
  socialProviderFromRoute,
  socialProviderPath,
  XBrandIcon,
} from "@/features/spaces";
import { MistyBrandIcon } from "@/features/workspace";
import { SiDiscord } from "react-icons/si";
import { NavigatorToolDisclosure } from "./NavigatorToolDisclosure";

type SocialDestinationId = "misty" | "instagram" | "discord" | "messenger" | "x";

function MistyNavigatorIcon(props: { className?: string; "aria-hidden"?: boolean }) {
  return <MistyBrandIcon {...props} size={18} />;
}

export function SocialNavigatorDisclosure(props: {
  accountId: string;
  spaceId: string;
  active: boolean;
  activeRoute: string;
  path: string;
}) {
  const socialPath = `/spaces/${encodeURIComponent(props.spaceId)}/social`;
  const activeDestination = props.active ? socialDestinationFromRoute(props.activeRoute) : null;
  const rootDestination = activeDestination ?? "misty";
  const destinations = [
    {
      id: "misty" as const,
      label: "Misty",
      icon: MistyNavigatorIcon,
      path: socialProviderPath(props.spaceId, "misty"),
    },
    {
      id: "instagram" as const,
      label: "Instagram",
      icon: InstagramBrandIcon,
      path: socialProviderPath(props.spaceId, "instagram"),
    },
    {
      id: "messenger" as const,
      label: "Messenger",
      icon: MessengerBrandIcon,
      path: socialProviderPath(props.spaceId, "messenger"),
    },
    {
      id: "x" as const,
      label: "X",
      icon: XBrandIcon,
      path: socialProviderPath(props.spaceId, "x"),
    },
    {
      id: "discord" as const,
      label: "Discord",
      icon: SiDiscord,
      path: socialProviderPath(props.spaceId, "discord"),
    },
  ];

  return (
    <NavigatorToolDisclosure
      accountId={props.accountId}
      appId="social"
      label="Social"
      path={`${socialPath}/${rootDestination}`}
      active={props.active}
      activeDestination={activeDestination}
      destinations={destinations}
    />
  );
}

function socialDestinationFromRoute(route: string): SocialDestinationId {
  return socialProviderFromRoute(route);
}
