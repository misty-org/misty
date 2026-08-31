import {
  AlbumsDestinationIcon,
  AllItemsDestinationIcon,
  CollectionsDestinationIcon,
  DeletedDestinationIcon,
  FavoritesDestinationIcon,
} from "./NavigatorDestinationIcons";
import { NavigatorToolDisclosure } from "./NavigatorToolDisclosure";

type LibraryDestinationId = "recent" | "favorites" | "collections" | "albums" | "deleted";

const destinationDetails = [
  { id: "recent" as const, label: "All items", icon: AllItemsDestinationIcon },
  { id: "favorites" as const, label: "Favorites", icon: FavoritesDestinationIcon },
  { id: "collections" as const, label: "Collections", icon: CollectionsDestinationIcon },
  { id: "albums" as const, label: "Albums", icon: AlbumsDestinationIcon },
  { id: "deleted" as const, label: "Recently deleted", icon: DeletedDestinationIcon },
];

export function LibraryNavigatorDisclosure(props: {
  accountId: string;
  spaceId: string;
  active: boolean;
  activeRoute: string;
  path: string;
}) {
  const libraryPath = `/spaces/${encodeURIComponent(props.spaceId)}/library`;
  const destinations = destinationDetails.map((destination) => ({
    ...destination,
    path: destination.id === "recent" ? libraryPath : `${libraryPath}?collection=${destination.id}`,
  }));

  return (
    <NavigatorToolDisclosure
      accountId={props.accountId}
      appId="library"
      label="Library"
      path={props.path}
      active={props.active}
      activeDestination={props.active ? libraryDestinationFromRoute(props.activeRoute) : null}
      destinations={destinations}
    />
  );
}

function libraryDestinationFromRoute(route: string): LibraryDestinationId {
  try {
    const collection = new URL(route, "https://misty.local").searchParams.get("collection");
    if (
      collection === "favorites" ||
      collection === "collections" ||
      collection === "albums" ||
      collection === "deleted"
    ) {
      return collection;
    }
  } catch {
    // The all-items collection is the safe fallback for malformed routes.
  }
  return "recent";
}
