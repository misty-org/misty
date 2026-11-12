import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  FolderPlus,
  Pencil,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  ErrorNotification,
  Input,
  MenuItem,
  MenuSubmenu,
  MenuTrigger,
  Skeleton,
} from "@/shared/ui";
import {
  currentSpaceKey,
  folderLabel,
  folderName,
  folderOf,
  spaceFolderList,
  useSpaceFolders,
} from "../engines/enginesApi";
import { errorText } from "./projectApi";
import { FolderAvatar } from "./folders/FolderAvatars";

/** The Space's linked folders, and which one the panels and engines work in. */
export function useProjectFolder(): { space: string; folder: string; loaded: boolean } {
  const space = currentSpaceKey();
  const folder = useSpaceFolders((state) => folderOf(state, space));
  const loaded = useSpaceFolders((state) => state.folders[space] !== undefined);
  useEffect(() => {
    void useSpaceFolders
      .getState()
      .load(space)
      .catch(() => undefined);
  }, [space]);
  return { space, folder, loaded };
}

/** Names a folder in the Space's lists. */
function RenameFolderDialog(props: {
  space: string;
  path: string | null;
  onClose(): void;
  onError(message: string): void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.path) setName(folderLabel(useSpaceFolders.getState(), props.space, props.path));
  }, [props.path, props.space]);
  return (
    <Dialog open={props.path !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.select();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!props.path) return;
            void useSpaceFolders
              .getState()
              .rename(props.space, props.path, name)
              .catch((reason) => props.onError(errorText(reason)));
            props.onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <Input
            ref={inputRef}
            aria-label="Name"
            value={name}
            placeholder={props.path ? folderName(props.path) : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit">Rename</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The folder the panel shows, as a menu: the Space's linked folders in the person's order, with a
 * checkmark on the one in use; each can be renamed, moved up or down, archived (still linked, out
 * of the way) or unlinked, and another can be linked through the system's folder picker. What is
 * chosen, named and ordered is kept for this device. `compact` draws it as quiet text, for the
 * session card's Project heading.
 */
export function FolderPicker({ compact = false }: { compact?: boolean }) {
  const { space, folder, loaded } = useProjectFolder();
  const active = useSpaceFolders((state) => spaceFolderList(state, space));
  const all = useSpaceFolders((state) => spaceFolderList(state, space, true));
  const label = useSpaceFolders((state) => (folder ? folderLabel(state, space, folder) : ""));
  const labels = useSpaceFolders((state) => state.prefs[space]?.names);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const store = useSpaceFolders.getState;
  const report = (work: Promise<unknown>) =>
    void work.catch((reason) => setError(errorText(reason)));
  const archived = all.filter((path) => !active.includes(path));
  const name = (path: string) => labels?.[path] ?? folderName(path);
  // The row's name after its owner's GitHub avatar, or the folder icon.
  const rowLabel = (path: string) => (
    <span className="flex min-w-0 items-center gap-2">
      <FolderAvatar path={path} />
      <span className="min-w-0 truncate">{name(path)}</span>
    </span>
  );

  if (!loaded) return <Skeleton className={compact ? "h-3 w-20" : "h-6 w-36"} />;
  if (!folder && archived.length === 0)
    return (
      <>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size="sm"
          className={compact ? "folder-picker-compact" : undefined}
          onClick={() => report(store().link(space))}
        >
          {compact ? null : <FolderPlus size={15} />}
          Link a folder
        </Button>
        <ErrorNotification message={error} onDismiss={() => setError("")} />
      </>
    );
  return (
    <>
      <DropdownMenu>
        <MenuTrigger
          label="Project folder"
          value={<span className="truncate">{folder ? label : "No folder"}</span>}
          variant="ghost"
          title={folder}
          chevron={!compact}
          className={compact ? "folder-picker-compact" : "min-w-0"}
        />
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-16px)]">
          {active.map((path, index) => (
            <MenuSubmenu
              key={path}
              icon={path === folder ? <Check className="size-4" /> : <span className="size-4" />}
              label={rowLabel(path)}
              title={path}
            >
              <MenuItem
                icon={<Check className="size-4" />}
                label="Work in this folder"
                disabled={path === folder}
                onSelect={() => store().choose(space, path)}
              />
              <MenuItem
                icon={<Pencil className="size-4" />}
                label="Rename"
                onSelect={() => setRenaming(path)}
              />
              <MenuItem
                icon={<ArrowUp className="size-4" />}
                label="Move up"
                disabled={index === 0}
                onSelect={() => report(store().move(space, path, index - 1))}
              />
              <MenuItem
                icon={<ArrowDown className="size-4" />}
                label="Move down"
                disabled={index === active.length - 1}
                onSelect={() => report(store().move(space, path, index + 1))}
              />
              <DropdownMenuSeparator />
              <MenuItem
                icon={<Archive className="size-4" />}
                label="Archive"
                onSelect={() => report(store().archive(space, path, true))}
              />
              <MenuItem
                icon={<X className="size-4" />}
                label="Unlink"
                onSelect={() => report(store().unlink(space, path))}
              />
            </MenuSubmenu>
          ))}
          {archived.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Archived</DropdownMenuLabel>
              {archived.map((path) => (
                <MenuSubmenu
                  key={path}
                  icon={<span className="size-4" />}
                  label={rowLabel(path)}
                  title={path}
                >
                  <MenuItem
                    icon={<ArchiveRestore className="size-4" />}
                    label="Restore"
                    onSelect={() => report(store().archive(space, path, false))}
                  />
                  <MenuItem
                    icon={<X className="size-4" />}
                    label="Unlink"
                    onSelect={() => report(store().unlink(space, path))}
                  />
                </MenuSubmenu>
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <MenuItem
            icon={<FolderPlus className="size-4" />}
            label="Link a folder"
            onSelect={() => report(store().link(space))}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameFolderDialog
        space={space}
        path={renaming}
        onClose={() => setRenaming(null)}
        onError={setError}
      />
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </>
  );
}
