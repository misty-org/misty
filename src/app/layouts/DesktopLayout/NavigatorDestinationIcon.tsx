import { WebsiteBrandIcon } from "../../../shared/toolAssets/WebsiteBrandIcon";
import {
  websiteIntegrations,
  type WebsiteIntegrationId,
} from "../../../shared/toolAssets/websiteIntegrations";
import { ProviderBrandIcon } from "../../../shared/toolAssets/ProviderBrandIcon";
import { providerFromRoute } from "../../../shared/toolAssets/providers";
import {
  NotesDestinationIcon,
  DrawingsDestinationIcon,
  TasksDestinationIcon,
  AgendaDestinationIcon,
  RoadmapsDestinationIcon,
  ExplorerDestinationIcon,
  TransfersDestinationIcon,
  AllItemsDestinationIcon,
  FavoritesDestinationIcon,
  CollectionsDestinationIcon,
  AlbumsDestinationIcon,
  DeletedDestinationIcon,
} from "./NavigatorDestinationIcons";
import { MistyBrandIcon } from "@/features/workspace/MistyBrandIcon";
import { MailProviderIcon } from "@/shared/ui/mail-provider-icon";
import { Link2, Plug } from "lucide-react";
import { BotMessageSquare, Workflow } from "lucide-react";
import type { MistyNavigationItem } from "@misty/sdk";
import { FileText } from "lucide-react";
import type { NavigatorAppId } from "@/features/workspace";

function isPinnedDestination(item: MistyNavigationItem) {
  return (
    item.id.startsWith("pin-") ||
    !!new URL(item.route, "https://misty.local").searchParams.get("pin")
  );
}

export function DestinationIcon({
  appId,
  item,
}: {
  appId: NavigatorAppId;
  item: MistyNavigationItem;
}) {
  if (appId === "files") {
    if (item.id === "explorer") return <ExplorerDestinationIcon aria-hidden />;
    if (item.id === "transfers") return <TransfersDestinationIcon aria-hidden />;
  }
  if (isPinnedDestination(item)) return <Link2 aria-hidden />;
  if (item.id === "misty") return <MistyBrandIcon size={18} />;
  if (Object.prototype.hasOwnProperty.call(websiteIntegrations, item.id))
    return <WebsiteBrandIcon id={item.id as WebsiteIntegrationId} size={18} />;
  const nativeIcon = {
    notes: NotesDestinationIcon,
    tasks: TasksDestinationIcon,
    agenda: AgendaDestinationIcon,
    roadmaps: RoadmapsDestinationIcon,
    drawings: DrawingsDestinationIcon,
  }[item.id];
  if (nativeIcon) {
    const Icon = nativeIcon;
    return <Icon aria-hidden />;
  }
  if (
    item.id === "integrations" &&
    (appId === "social" || appId === "inbox" || appId === "music" || appId === "media")
  )
    return <Plug aria-hidden />;
  if (appId === "social" || appId === "inbox" || appId === "music" || appId === "media") {
    const family = appId === "social" ? "chat" : appId;
    const provider = providerFromRoute(item.route, family);
    if (provider) return <ProviderBrandIcon provider={provider} size={18} />;
  }
  if (appId === "inbox") {
    const provider =
      new URL(item.route, "https://misty.local").searchParams.get("provider") ?? item.id;
    if (provider === "google" || provider === "microsoft")
      return <MailProviderIcon provider={provider} />;
  }
  if (appId === "social" || appId === "music" || appId === "media") {
    const family = appId === "social" ? "chat" : appId;
    const provider = providerFromRoute(
      `/apps/${appId}?provider=${encodeURIComponent(item.id)}`,
      family,
    );
    if (provider) return <ProviderBrandIcon provider={provider} size={18} />;
  }
  if (appId === "library") {
    const Icon = {
      recent: AllItemsDestinationIcon,
      favorites: FavoritesDestinationIcon,
      collections: CollectionsDestinationIcon,
      albums: AlbumsDestinationIcon,
      deleted: DeletedDestinationIcon,
    }[item.id];
    if (Icon) return <Icon aria-hidden />;
  }
  if (appId === "agents") {
    const Icon = item.id === "automations" ? Workflow : BotMessageSquare;
    return <Icon aria-hidden />;
  }
  return <FileText aria-hidden />;
}
