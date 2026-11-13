import {
  NotesDestinationIcon,
  DrawingsDestinationIcon,
  AllItemsDestinationIcon,
  FavoritesDestinationIcon,
  CollectionsDestinationIcon,
  DeletedDestinationIcon,
} from "./NavigatorDestinationIcons";
import type { NavigationItem as MistyNavigationItem } from "@/app/layouts/DesktopLayout/NavigationItem";
import { FileText } from "lucide-react";

/** The icon for a section of an app, such as a Space's notes or the library's favorites. */
export function DestinationIcon({
  appId,
  item,
}: {
  /** The workspace app the destination belongs to, such as "journal" or "library". */
  appId: string;
  item: MistyNavigationItem;
}) {
  const nativeIcon = {
    notes: NotesDestinationIcon,
    drawings: DrawingsDestinationIcon,
  }[item.id];
  if (nativeIcon) {
    const Icon = nativeIcon;
    return <Icon aria-hidden />;
  }
  if (appId === "library") {
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
