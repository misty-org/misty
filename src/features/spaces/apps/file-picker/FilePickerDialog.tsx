import { open as openSystemDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  Button,
  CollectionItems,
  CollectionSkeleton,
  CollectionViewToggle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  IconButton,
  SearchField,
  Spinner,
  Text,
  ToolbarDivider,
  useCollectionView,
} from "@misty/ui";
import { useChatFolders, useProjectFolders } from "@/features/agents";
import { mimeFromName } from "../../drive/driveEntries";
import { acceptsFile } from "../spaceAppFiles";
import { nameOfPath, type PickedFiles } from "./chosenFiles";
import { PickerSidebar } from "./PickerSidebar";
import { pickerColumns, pickerItem } from "./pickerItems";
import {
  COMPUTER,
  enclosingFolders,
  placeKey,
  placeName,
  samePlace,
  spaceDriveRoot,
  type PickerPlace,
} from "./pickerPlaces";
import { isFolderEntry, usePickerListing, type PickerEntry } from "./usePickerListing";

const messageOf = (reason: unknown) =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";

const projectPlace = (path: string): PickerPlace => ({ kind: "folder", root: path, path });

/**
 * Choosing files, laid out like Finder's Open panel: places on the left, the place's files as a
 * list or a grid, Back and Forward, and a search over what the place holds. A click selects (with
 * ⌘ and ⇧ for more when several may be chosen), a double click or Enter opens a folder or chooses
 * a file. Other files reaches anywhere else on this computer through the system's own dialog.
 *
 * `open` is an app asking for files: the Space's drive (its Files) comes first, and only the files
 * it accepts show; one chosen from this computer is copied into the drive for the app.
 * `upload` is adding files to Media: only this computer, opening on the most recent project.
 * `onPick` takes what was chosen; while it runs the picker waits, and if it fails it says why.
 */
export function FilePickerDialog({
  purpose,
  spaceId,
  accept = [],
  multiple,
  onPick,
  onCancel,
}: {
  purpose: "open" | "upload";
  spaceId: string;
  accept?: string[];
  multiple: boolean;
  onPick(picked: PickedFiles): Promise<void> | void;
  onCancel(): void;
}) {
  const projects = useProjectFolders();
  const [history, setHistory] = useState<{ places: PickerPlace[]; at: number }>({
    places: [purpose === "open" ? spaceDriveRoot(spaceId) : COMPUTER],
    at: 0,
  });
  const place = history.places[history.at];
  const listing = usePickerListing(spaceId, place, accept);
  const [view, setView] = useCollectionView("file-picker", "list");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  // Adding to Media starts in the project used last, as soon as the projects are known.
  const firstProject = projects?.[0]?.path;
  useEffect(() => {
    if (firstProject && history.places.length === 1 && history.places[0].kind === "computer")
      setHistory({ places: [projectPlace(firstProject)], at: 0 });
  }, [firstProject, history]);

  const arrive = (update: (now: typeof history) => typeof history) => {
    setHistory(update);
    setSelected([]);
    anchor.current = undefined;
    setQuery("");
    setFailure("");
  };
  const go = (next: PickerPlace) => {
    if (samePlace(next, place)) return;
    arrive((now) => ({ places: [...now.places.slice(0, now.at + 1), next], at: now.at + 1 }));
  };
  const step = (by: -1 | 1) => arrive((now) => ({ ...now, at: now.at + by }));
  const enclosing = enclosingFolders(place);
  const up = enclosing.length > 1 ? enclosing[enclosing.length - 2] : undefined;
  const addFolder = async () => {
    const path = await useChatFolders
      .getState()
      .addProject()
      .catch(() => null);
    if (path) go(projectPlace(path));
  };

  const needle = query.trim().toLocaleLowerCase();
  const entries =
    listing.status === "ready"
      ? listing.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
      : [];
  const chosen = entries.filter((entry) => selected.includes(entry.id));
  const chosenFolder = chosen.length === 1 && isFolderEntry(chosen[0]) ? chosen[0] : undefined;
  const chosenFileCount = chosen.filter((entry) => !isFolderEntry(entry)).length;

  const pick = async (picked: PickedFiles) => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      await onPick(picked);
    } catch (reason) {
      setFailure(messageOf(reason) || "The files couldn't be added.");
    } finally {
      setBusy(false);
    }
  };
  const choose = (picked: PickerEntry[]) => {
    const files = picked.filter((entry) => !isFolderEntry(entry));
    if (!files.length) return;
    void pick({
      drive: files.flatMap((entry) => (entry.kind === "drive" ? [entry.entry] : [])),
      projectFiles: files.flatMap((entry) => (entry.kind === "local" ? [entry.path] : [])),
      otherFiles: [],
    });
  };
  const open = (entry: PickerEntry) => {
    if (entry.kind === "local" && entry.folder && place.kind === "folder")
      go({ kind: "folder", root: place.root, path: entry.path });
    else if (entry.kind === "drive" && entry.folder && place.kind === "space-drive")
      go({ kind: "space-drive", spaceId: place.spaceId, path: entry.entry.path });
    else choose([entry]);
  };
  const chooseOtherFiles = async () => {
    // The system's dialog filters by extension only; other kinds are checked once chosen.
    const extensions = accept.filter((kind) => kind.startsWith(".")).map((kind) => kind.slice(1));
    const answer = await openSystemDialog({
      multiple,
      directory: false,
      filters:
        extensions.length && extensions.length === accept.length
          ? [{ name: "Files", extensions }]
          : undefined,
    }).catch(() => null);
    const paths = answer === null ? [] : Array.isArray(answer) ? answer : [answer];
    if (!paths.length) return;
    const refused = paths.find(
      (path) => !acceptsFile(accept, mimeFromName(nameOfPath(path)), nameOfPath(path)),
    );
    if (refused) return setFailure(`${nameOfPath(refused)} can't be opened here.`);
    void pick({ drive: [], projectFiles: [], otherFiles: paths });
  };

  /** A click selects; a double click, or Enter on a focused row, opens. */
  const select = (event: MouseEvent, id: string, onOpen: () => void) => {
    if (busy) return;
    if (event.detail !== 1) return onOpen();
    const ids = entries.map((entry) => entry.id);
    if (multiple && event.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const [from, to] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((a, b) => a - b);
      return setSelected(ids.slice(from, to + 1));
    }
    anchor.current = id;
    if (multiple && (event.metaKey || event.ctrlKey))
      return setSelected((now) =>
        now.includes(id) ? now.filter((other) => other !== id) : [...now, id],
      );
    setSelected([id]);
  };

  const body =
    place.kind === "computer" ? (
      projects?.length === 0 ? (
        <EmptyState
          inline
          title="No folders yet"
          line="Add a folder to browse it here."
          action={{ label: "Add folder", variant: "secondary", onClick: () => void addFolder() }}
        />
      ) : (
        <CollectionSkeleton label="Loading files" view={view} icons />
      )
    ) : listing.status === "loading" ? (
      <CollectionSkeleton label="Loading files" view={view} icons />
    ) : listing.status === "failed" ? (
      <ErrorState
        inline
        title={
          place.kind === "space-drive" && place.path === "/"
            ? "Files couldn't load"
            : "This folder couldn't open"
        }
        action={{ label: "Try again", variant: "secondary", onClick: listing.retry }}
      />
    ) : listing.entries.length === 0 ? (
      <EmptyState
        inline
        title={purpose === "open" ? "No files to open" : "This folder is empty"}
        line={
          place.kind === "space-drive"
            ? "Files this app can open show up here."
            : purpose === "open"
              ? "This folder has no files this app can open."
              : "Files in this folder show up here."
        }
      />
    ) : entries.length === 0 ? (
      <EmptyState inline title="No matching files" line="Try a different name." />
    ) : (
      <>
        <CollectionItems
          view={view}
          columns={pickerColumns}
          columnSetId="file-picker"
          remember="file-picker"
          sortResetKey={placeKey(place)}
          listIcons
          gridLayout="preview"
          items={entries.map((entry) => pickerItem(spaceId, entry, open))}
          selectedIds={selected}
          onSelect={select}
        />
        {listing.more ? (
          <Button
            variant="secondary"
            className="mx-auto mt-4 flex"
            disabled={listing.loadingMore}
            onClick={listing.more}
          >
            Load more
          </Button>
        ) : null}
      </>
    );

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && !busy && onCancel()}>
      <DialogContent
        size="xl"
        layout="scroll"
        tone="page"
        aria-describedby={undefined}
        className="h-[min(40rem,calc(100dvh-4rem))] gap-0 p-0"
      >
        <DialogHeader className="h-16 flex-row items-center gap-1 px-4 pr-16">
          <IconButton label="Back" disabled={history.at === 0} onClick={() => step(-1)}>
            <ChevronLeft />
          </IconButton>
          <IconButton
            label="Forward"
            disabled={history.at === history.places.length - 1}
            onClick={() => step(1)}
          >
            <ChevronRight />
          </IconButton>
          {up && place.kind !== "computer" ? (
            <IconButton
              label="Enclosing folder"
              onClick={() =>
                go(
                  place.kind === "folder"
                    ? { kind: "folder", root: place.root, path: up.path }
                    : { kind: "space-drive", spaceId: place.spaceId, path: up.path },
                )
              }
            >
              <ArrowUp />
            </IconButton>
          ) : null}
          <DialogTitle className="ml-2 min-w-0 flex-1">
            <Text size="title" weight="semibold" tone="bright" full>
              {placeName(place)}
            </Text>
          </DialogTitle>
          <CollectionViewToggle value={view} onChange={setView} />
          <ToolbarDivider />
          <SearchField
            aria-label={`Search ${placeName(place)}`}
            placeholder="Search"
            containerClassName="w-48 shrink-0"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-4 px-4">
          <div className="w-52 shrink-0 overflow-y-auto pb-4">
            <PickerSidebar
              place={place}
              driveSpaceId={purpose === "open" ? spaceId : undefined}
              projects={projects}
              onGo={go}
              onAddFolder={() => void addFolder()}
            />
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto pb-4">{body}</div>
        </div>
        <DialogFooter className="px-6 pb-5 pt-3">
          <Button
            variant="secondary"
            size="lg"
            disabled={busy}
            onClick={() => void chooseOtherFiles()}
          >
            Other files
          </Button>
          <div className="mr-auto flex min-w-0 items-center gap-2 pl-2">
            {busy ? <Spinner label="Adding files" /> : null}
            {failure ? (
              <Text tone="danger" role="alert">
                {failure}
              </Text>
            ) : null}
          </div>
          <Button variant="quiet" size="lg" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={busy || (!chosenFolder && chosenFileCount === 0)}
            onClick={() => (chosenFolder ? open(chosenFolder) : choose(chosen))}
          >
            {purpose === "open" ? "Open" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
