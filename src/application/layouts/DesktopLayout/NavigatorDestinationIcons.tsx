import {
  ArrowLeftRight,
  CalendarDays,
  FolderOpen,
  Folders,
  Heart,
  Images,
  ListTodo,
  NotebookPen,
  Pencil,
  Route,
  Trash2,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

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

export const NotesDestinationIcon = destinationIcon(NotebookPen, "notes");
export const DrawingsDestinationIcon = destinationIcon(Pencil, "drawings");
export const TasksDestinationIcon = destinationIcon(ListTodo, "tasks");
export const AgendaDestinationIcon = destinationIcon(CalendarDays, "agenda");
export const RoadmapsDestinationIcon = destinationIcon(Route, "roadmaps");
export const ExplorerDestinationIcon = destinationIcon(FolderOpen, "explorer");
export const TransfersDestinationIcon = destinationIcon(ArrowLeftRight, "transfers");
export const AllItemsDestinationIcon = destinationIcon(Images, "all-items");
export const FavoritesDestinationIcon = destinationIcon(Heart, "favorites");
export const CollectionsDestinationIcon = destinationIcon(Folders, "collections");
export const AlbumsDestinationIcon = destinationIcon(Images, "albums");
export const DeletedDestinationIcon = destinationIcon(Trash2, "deleted");
