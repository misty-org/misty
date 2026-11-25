import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/features/account";
import { AgentAvatar, defaultAgentOf, usePersonalAgentsStore } from "@/features/agents";
import { spaceWorkspaceToolFromRoute, type WorkspaceView } from "@/features/app-windows";
import { dmOthers, useDms } from "@/features/direct";
import { catalogLogoUrl, ChatAvatar, useMemberPicture, useRegistryApps } from "@/features/spaces";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { SiteIcon, useWebTabs, webTabIdOfRoute } from "@/features/browser";
import { AppLogoImage, appIcons, spaceIcons } from "@misty/ui";

const agentPlaces: Record<string, LucideIcon> = {
  files: spaceIcons.files,
  memory: appIcons.memory,
};

function decoded(part: string | undefined): string {
  try {
    return decodeURIComponent(part ?? "");
  } catch {
    return "";
  }
}

function Glyph({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" />;
}

function AgentTabFace({ agentId }: { agentId: string | null }) {
  const agent = usePersonalAgentsStore((state) =>
    agentId
      ? state.agents.find((item) => item.id === agentId)
      : (state.agents.find(
          (item) => item.id === state.selected.global && item.enabled && !item.system_managed,
        ) ??
        state.agents.find((item) => item.engine && item.enabled) ??
        defaultAgentOf(state.agents)),
  );
  return <AgentAvatar agent={agent} glyph />;
}

function DmTabFace({ dmId }: { dmId: string }) {
  const { user } = useAuth();
  const dms = useDms();
  const dm = dms.data?.find((item) => item.id === dmId);
  const other = dm ? dmOthers(dm, user?.id)[0] : undefined;
  const picture = useMemberPicture(other?.user_id ?? "", other?.avatar_version ?? 0);
  if (!other) return null;
  return (
    <ChatAvatar
      id={other.user_id}
      name={other.username}
      src={picture ?? undefined}
      size="glyph"
      outline={avatarOutline(other.avatar_decoration)}
    />
  );
}

function AppTabLogo({ appId }: { appId: string }) {
  const entry = useRegistryApps().find((item) => item.id === appId);
  if (!entry) return null;
  return (
    <AppLogoImage
      src={catalogLogoUrl(entry) || undefined}
      name={entry.name}
      size="glyph"
      render={entry.icon_render}
    />
  );
}

function WebTabIcon({ route }: { route: string }) {
  const tabId = webTabIdOfRoute(route);
  const url = useWebTabs((state) => state.tabs[tabId]?.url ?? "");
  const favicon = useWebTabs((state) => state.tabs[tabId]?.faviconUrl);
  if (!/^https?:\/\//i.test(url)) return <Glyph icon={spaceIcons.browser} />;
  return (
    <SiteIcon
      url={url}
      icon={favicon}
      className="size-4 shrink-0 select-none rounded-sm object-contain"
    />
  );
}

export function WorkspaceTabIcon({ view }: { view?: WorkspaceView }) {
  if (!view || view.placeholder) return null;
  const url = new URL(view.route, "https://misty.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (view.surfaceId === "agents") {
    const place = url.searchParams.get("view");
    if (!place) return <AgentTabFace agentId={url.searchParams.get("agent")} />;
    const icon = agentPlaces[place];
    return icon ? <Glyph icon={icon} /> : null;
  }
  if (view.surfaceId === "browser") return <WebTabIcon route={view.route} />;
  if (view.surfaceId === "direct") {
    if (parts[0] === "dms" && parts[1]) return <DmTabFace dmId={decoded(parts[1])} />;
    return <Glyph icon={spaceIcons.friends} />;
  }
  if (view.surfaceId === "space") {
    if (!parts[1]) return <Glyph icon={spaceIcons.space} />;
    if (parts[2] === "app") return <AppTabLogo appId={decoded(parts[3])} />;
    if (parts[2] === "voice") return <Glyph icon={spaceIcons.voice} />;
    const tool = spaceWorkspaceToolFromRoute(view.route);
    if (tool === "explore") return <Glyph icon={spaceIcons.explore} />;
    if (tool === "files") return <Glyph icon={spaceIcons.files} />;
    return <Glyph icon={spaceIcons.channel} />;
  }
  return null;
}
