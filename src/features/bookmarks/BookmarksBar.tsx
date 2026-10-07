import { ChevronsRight, Folder } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SavedWebsiteIcon } from "@/features/browser-workspace/SavedWebsiteIcon";
import { useBrowserOverlayControl } from "@/features/browser";
import { openFromChrome } from "@/features/browser/workspace";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuItem,
  MenuSubmenu,
  Pressable,
  cn,
} from "@/shared/ui";
import {
  bookmarksBarId,
  otherBookmarksId,
  useBookmarkLibrary,
  type BookmarkNode,
  type BookmarkTree,
} from "./library";

const itemClass = cn(
  "flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-cream-muted",
  "hover:bg-control-hover hover:text-cream-bright data-[state=open]:bg-control-hover",
);

function open(url: string, event?: { metaKey?: boolean; ctrlKey?: boolean }) {
  openFromChrome(url, { newTab: Boolean(event?.metaKey || event?.ctrlKey) });
}

/** A folder's contents as menu rows; subfolders become submenus. */
function FolderMenuItems({ tree, folderId }: { tree: BookmarkTree; folderId: string }) {
  const children = tree.children(folderId);
  const links = children.filter((node) => node.kind === "bookmark");
  if (!children.length) return <MenuItem label="Empty folder" disabled />;
  return (
    <>
      {children.map((node) =>
        node.kind === "folder" ? (
          <MenuSubmenu key={node.id} icon={<Folder size={14} aria-hidden />} label={node.name}>
            <FolderMenuItems tree={tree} folderId={node.id} />
          </MenuSubmenu>
        ) : (
          <MenuItem
            key={node.id}
            icon={<SavedWebsiteIcon url={node.url} />}
            label={node.title}
            title={node.url}
            onSelect={() => open(node.url)}
          />
        ),
      )}
      {links.length > 1 && (
        <>
          <DropdownMenuSeparator />
          <MenuItem
            label={`Open all (${links.length})`}
            onSelect={() => links.forEach((b) => openFromChrome(b.url, { newTab: true }))}
          />
        </>
      )}
    </>
  );
}

/** A bar menu. Native pages draw above the app, so they step aside before it opens. */
function BarMenu(props: {
  id: string;
  label: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  children: ReactNode;
}) {
  const overlay = useBrowserOverlayControl(`bookmarks-bar:${props.id}`);
  return (
    <DropdownMenu modal={false} open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Pressable className={itemClass} aria-label={props.iconOnly ? props.label : undefined}>
          {props.icon}
          {!props.iconOnly && <span className="min-w-0 truncate">{props.label}</span>}
        </Pressable>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-56 overflow-y-auto">
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FolderButton(props: {
  tree: BookmarkTree;
  folderId: string;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <BarMenu id={props.folderId} label={props.label} icon={props.icon}>
      <FolderMenuItems tree={props.tree} folderId={props.folderId} />
    </BarMenu>
  );
}

function BarItem({ node, tree }: { node: BookmarkNode; tree: BookmarkTree }) {
  if (node.kind === "folder")
    return (
      <FolderButton
        tree={tree}
        folderId={node.id}
        label={node.name}
        icon={<Folder size={14} aria-hidden />}
      />
    );
  return (
    <Pressable
      className={itemClass}
      title={`${node.title}\n${node.url}`}
      onClick={(event) => open(node.url, event)}
      onAuxClick={(event) => event.button === 1 && openFromChrome(node.url, { newTab: true })}
    >
      <span className="grid size-4 shrink-0 place-items-center">
        <SavedWebsiteIcon url={node.url} />
      </span>
      <span className="min-w-0 truncate">{node.title}</span>
    </Pressable>
  );
}

/**
 * The Bookmarks bar root as a row under the tab strip, like every major
 * browser. Items that do not fit move into a trailing menu; Other bookmarks
 * sits at the end once it has anything in it.
 */
export function BookmarksBar() {
  const tree = useBookmarkLibrary();
  const document = useSettingsStore((state) => state.settings?.document);
  const shown = settingsBoolean(document ?? {}, "general", "browser_bookmarks_bar", true);
  const items = tree.children(bookmarksBarId);
  const hasOther = tree.children(otherBookmarksId).length > 0;
  const row = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(items.length);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      // Reserve room for the overflow and Other bookmarks buttons.
      const limit = element.clientWidth - 40 - (hasOther ? 150 : 0);
      const children = [...element.querySelectorAll<HTMLElement>("[data-bar-item]")];
      const count = children.findIndex((child) => child.offsetLeft + child.offsetWidth > limit);
      setFits(count < 0 ? children.length : count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length, hasOther, tree]);
  if (!shown || (!items.length && !hasOther)) return null;
  const overflow = items.slice(fits);
  return (
    <div
      ref={row}
      role="toolbar"
      aria-label="Bookmarks bar"
      className="relative flex h-8 shrink-0 items-center gap-0.5 overflow-hidden bg-charcoal-border px-2"
      data-bookmarks-bar
    >
      {items.map((node, index) => (
        <div
          key={node.id}
          data-bar-item
          className={cn("flex shrink-0", index >= fits && "invisible absolute")}
          aria-hidden={index >= fits || undefined}
        >
          <BarItem node={node} tree={tree} />
        </div>
      ))}
      {overflow.length > 0 && (
        <BarMenu
          id="overflow"
          label="More bookmarks"
          icon={<ChevronsRight size={14} aria-hidden />}
          iconOnly
        >
          {overflow.map((node) =>
            node.kind === "folder" ? (
              <MenuSubmenu key={node.id} icon={<Folder size={14} aria-hidden />} label={node.name}>
                <FolderMenuItems tree={tree} folderId={node.id} />
              </MenuSubmenu>
            ) : (
              <MenuItem
                key={node.id}
                icon={<SavedWebsiteIcon url={node.url} />}
                label={node.title}
                onSelect={() => open(node.url)}
              />
            ),
          )}
        </BarMenu>
      )}
      {hasOther && (
        <div className="ml-auto flex shrink-0 border-l border-charcoal-hover pl-1">
          <FolderButton
            tree={tree}
            folderId={otherBookmarksId}
            label="Other bookmarks"
            icon={<Folder size={14} aria-hidden />}
          />
        </div>
      )}
    </div>
  );
}
