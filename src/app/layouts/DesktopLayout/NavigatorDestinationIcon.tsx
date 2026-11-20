import {
  AllItemsDestinationIcon,
  FavoritesDestinationIcon,
  CollectionsDestinationIcon,
  DeletedDestinationIcon,
} from "./NavigatorDestinationIcons";
import type { NavigationItem as MistyNavigationItem } from "@/app/layouts/DesktopLayout/NavigationItem";
import { FileText } from "lucide-react";

/** The icon for a section of a page, such as Files' favorites. */
export function DestinationIcon({
  appId,
  item,
}: {
  /** The workspace page the destination belongs to, such as "files". */
  appId: string;
  item: MistyNavigationItem;
}) {
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
