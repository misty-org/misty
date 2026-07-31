import { Folder, Heart, Images, Trash2 } from "lucide-react";

export const librarySidebarItems = [
  { collection: "recent", label: "All items", icon: Images },
  { collection: "favorites", label: "Favorites", icon: Heart },
  { collection: "collections", label: "Collections", icon: Folder },
  { collection: "albums", label: "Albums", icon: Images },
  { collection: "deleted", label: "Recently deleted", icon: Trash2 },
] as const;
