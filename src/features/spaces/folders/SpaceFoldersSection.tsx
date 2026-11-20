import { FolderOpen, FolderUp, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  MenuSeparator,
  useConfirmDelete,
  useNotice,
} from "@misty/ui";
import { driveNative, type DriveEntry } from "../drive/driveNative";
import { useDriveList } from "../drive/useDrive";
import { CopyFolderDialog, errorText } from "./CopyFolderDialog";
import { pickFolderToCopy } from "./shareFolder";

/**
 * The folders at the top of the Space's drive, in the Space menu's Shared folders dialog: each with
 * who last changed it and when. Copy into the Space picks a folder on this computer and copies it
 * in; a row's ⋯ shows it in the drive or moves it to the Space's trash.
 */
export function SpaceFoldersSection({ spaceId }: { spaceId: string }) {
  const listing = useDriveList(spaceId, "/");
  const [copying, setCopying] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirmDelete();
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  const pick = async () => {
    if (picking) return;
    setPicking(true);
    setError("");
    try {
      const localFolder = await pickFolderToCopy();
      if (!localFolder) return;
      setCopying(localFolder);
      setDialogOpen(true);
    } catch (cause) {
      setError(errorText(cause, "Misty couldn't open that folder."));
    } finally {
      setPicking(false);
    }
  };

  const reveal = (folder: DriveEntry) =>
    void driveNative
      .reveal(spaceId, folder.path)
      .catch((cause) => setError(errorText(cause, `${folder.name} couldn't be shown. Try again.`)));

  const remove = (folder: DriveEntry) =>
    void confirm({
      title: `Delete "${folder.name}"?`,
      what: "It moves to the Space's trash for everyone, and can be restored for 30 days.",
      onConfirm: () => driveNative.trash(spaceId, folder.path),
    });

  const folders =
    listing.status === "ready" ? listing.entries.filter((entry) => entry.kind === "folder") : null;
  const hasFolders = Boolean(folders?.length);
  const copyButton = (
    <Button
      type="button"
      variant="secondary"
      icon={FolderUp}
      disabled={picking}
      onClick={() => void pick()}
    >
      Copy into the Space
    </Button>
  );

  return (
    <div className="grid min-w-0 gap-3">
      {listing.status === "failed" ? (
        <ErrorState
          inline
          title="Shared folders couldn't load"
          line={listing.message || "Try again in a moment."}
          action={{ label: "Try again", onClick: listing.retry }}
        />
      ) : folders === null ? (
        <ListRowSkeleton label="Shared folders" rows={2} lines={2} state />
      ) : hasFolders ? (
        <div className="grid min-w-0">
          {folders.map((folder) => (
            <ListRow
              key={folder.id}
              label={folder.name}
              description={folder.modified_by_name || undefined}
              state={{ kind: "time", at: folder.mtime_ms }}
              menuLabel={`Actions for ${folder.name}`}
              menu={
                <>
                  <MenuItem icon={FolderOpen} label="Show in drive" onSelect={() => reveal(folder)} />
                  <MenuSeparator />
                  <MenuItem icon={Trash2} label="Delete" danger onSelect={() => remove(folder)} />
                </>
              }
            />
          ))}
          {listing.status === "ready" && listing.more ? (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" disabled={listing.loadingMore} onClick={listing.more}>
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          inline
          title="Nothing shared yet"
          line="Copy a folder into the Space so everyone in it can use its files."
          action={{
            label: "Copy into the Space",
            icon: FolderUp,
            disabled: picking,
            onClick: () => void pick(),
          }}
        />
      )}
      {hasFolders ? <div className="flex justify-end">{copyButton}</div> : null}
      {copying ? (
        <CopyFolderDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          spaceId={spaceId}
          localFolder={copying}
          // The copy shows in the list as the drive reports it.
          onCopied={() => undefined}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}
