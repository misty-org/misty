import {
  AllItemsDestinationIcon,
  FavoritesDestinationIcon,
  CollectionsDestinationIcon,
  DeletedDestinationIcon,
} from "./NavigatorDestinationIcons";
import type { NavigationItem as MistyNavigationItem } from "@/app/layouts/DesktopLayout/navigation_item";
import { FileText } from "lucide-react";

export function DestinationIcon({ appId, item }: { appId: string; item: MistyNavigationItem }) {
  if (appId === "files" || appId === "media" || appId === "library") {
    const Icon = {
      recent: AllItemsDestinationIcon,
      favorites: FavoritesDestinationIcon,
      collections: CollectionsDestinationIcon,
      deleted: DeletedDestinationIcon,
    }[item.id];
    if (Icon) return <Icon aria-hidden />;
  }
  return <FileText aria-hidden />;
}
