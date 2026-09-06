import { InstagramBrandIcon, MessengerBrandIcon, XBrandIcon } from "@/features/spaces";
import { MistyBrandIcon } from "@/features/workspace/MistyBrandIcon";
import { SiDiscord } from "react-icons/si";
import { NavigatorToolDisclosure } from "./NavigatorToolDisclosure";

type SocialDestinationId = "misty" | "instagram" | "discord" | "messenger" | "x";

function MistyNavigatorIcon(props: { className?: string; "aria-hidden"?: boolean }) {
  return <MistyBrandIcon {...props} size={18} />;
}

function DiscordNavigatorIcon(props: { className?: string; "aria-hidden"?: boolean }) {
  return <SiDiscord {...props} data-social-provider-icon="discord" />;
}

export function SocialNavigatorDisclosure(props: {
  accountId: string;
  spaceId: string;
  active: boolean;
  activeRoute: string;
  path: string;
}) {
  const socialPath = props.path;
  const activeDestination = props.active ? socialDestinationFromRoute(props.activeRoute) : null;
  const rootDestination = activeDestination ?? "misty";
  const destinations = [
    {
      id: "misty" as const,
      label: "Misty",
      icon: MistyNavigatorIcon,
      path: withQuery(socialPath, "provider", "misty"),
    },
    {
      id: "instagram" as const,
      label: "Instagram",
      icon: InstagramBrandIcon,
      path: withQuery(socialPath, "provider", "instagram"),
    },
    {
      id: "messenger" as const,
      label: "Messenger",
      icon: MessengerBrandIcon,
      path: withQuery(socialPath, "provider", "messenger"),
    },
    {
      id: "x" as const,
      label: "X",
      icon: XBrandIcon,
      path: withQuery(socialPath, "provider", "x"),
    },
    {
      id: "discord" as const,
      label: "Discord",
      icon: DiscordNavigatorIcon,
      path: withQuery(socialPath, "provider", "discord"),
    },
  ];

  return (
    <NavigatorToolDisclosure
      accountId={props.accountId}
      appId="social"
      label="Social"
      path={withQuery(socialPath, "provider", rootDestination)}
      active={props.active}
      activeDestination={activeDestination}
      destinations={destinations}
    />
  );
}

function socialDestinationFromRoute(route: string): SocialDestinationId {
  try {
    const value = new URL(route, "https://misty.local").searchParams.get("provider");
    return value === "instagram" || value === "discord" || value === "messenger" || value === "x"
      ? value
      : "misty";
  } catch {
    return "misty";
  }
}

function withQuery(route: string, key: string, value: string) {
  const url = new URL(route, "https://misty.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}
