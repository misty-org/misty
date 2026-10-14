import { Bookmark as BookmarkIcon, Folder, Star } from "lucide-react";
import { SavedWebsiteIcon } from "@/features/browser-workspace/SavedWebsiteIcon";
import { bookmarkRoots, favoritesId, useBookmarkLibrary } from "@/features/bookmarks/library";
import { useFavorites } from "@/features/bookmarks/favorites";
import { useWorkspaceStore } from "@/features/workspace";
import { MenuItem, MenuSubmenu } from "@/shared/ui";

const open = (url: string, bookmarkId?: string) =>
  useWorkspaceStore.getState().openBrowserView({ url, bookmarkId });

/** One folder's links, with its subfolders as panels that open to the side. */
function FolderItems({ folderId, depth = 0 }: { folderId: string; depth?: number }) {
  const tree = useBookmarkLibrary();
  const nodes = tree.children(folderId);
  if (!nodes.length) return <MenuItem icon={<Folder />} label="Empty" disabled />;
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          depth < 8 ? (
            <MenuSubmenu key={node.id} icon={<Folder />} label={node.name} width="lg">
              <FolderItems folderId={node.id} depth={depth + 1} />
            </MenuSubmenu>
          ) : null
        ) : (
          <MenuItem
            key={node.id}
            title={node.url}
            icon={<SavedWebsiteIcon url={node.url} />}
            label={node.title || node.url}
            onSelect={() => open(node.url, node.id)}
          />
        ),
      )}
    </>
  );
}

/** Favorites and Bookmarks as hover panels in the browser menu, where horizontal tabs keep them. */
export function BrowserLibraryMenus() {
  const favorites = useFavorites();
  const roots = bookmarkRoots.filter((root) => root.id !== favoritesId);
  return (
    <>
      <MenuSubmenu icon={<Star />} label="Favorites" width="lg">
        {favorites.length ? (
          favorites.map((favorite) => (
            <MenuItem
              key={favorite.id}
              title={favorite.url}
              icon={<SavedWebsiteIcon url={favorite.url} />}
              label={favorite.title || favorite.url}
              onSelect={() => open(favorite.url, favorite.id)}
            />
          ))
        ) : (
          <MenuItem icon={<Star />} label="No favorites yet" disabled />
        )}
      </MenuSubmenu>
      <MenuSubmenu icon={<BookmarkIcon />} label="Bookmarks" width="lg">
        {roots.map((root) => (
          <MenuSubmenu key={root.id} icon={<Folder />} label={root.label} width="lg">
            <FolderItems folderId={root.id} />
          </MenuSubmenu>
        ))}
      </MenuSubmenu>
    </>
  );
}
