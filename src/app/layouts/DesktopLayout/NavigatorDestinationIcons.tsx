import { Folders, Heart, Images, Trash2, type LucideIcon, type LucideProps } from "lucide-react";
import { spaceMadeKind } from "@misty/ui";

function destinationIcon(Icon: LucideIcon, feature: string) {
  return function DestinationIcon(props: LucideProps) {
    return (
      <Icon
        {...props}
        aria-hidden={props["aria-hidden"] ?? true}
        data-navigator-feature-icon={feature}
      />
    );
  };
}

export const NotesDestinationIcon = destinationIcon(spaceMadeKind("note").icon, "notes");
export const DrawingsDestinationIcon = destinationIcon(spaceMadeKind("drawing").icon, "drawings");
export const AllItemsDestinationIcon = destinationIcon(Images, "all-items");
export const FavoritesDestinationIcon = destinationIcon(Heart, "favorites");
export const CollectionsDestinationIcon = destinationIcon(Folders, "collections");
export const DeletedDestinationIcon = destinationIcon(Trash2, "deleted");
