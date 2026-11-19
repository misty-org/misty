import { Download, FolderUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  HomeSection,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  MenuSeparator,
  notify,
  Text,
  useConfirmDelete,
  useNotice,
} from "@/shared/ui";
import { formatBytes } from "../library/libraryFormat";
import { ShareFolderDialog, errorText } from "./ShareFolderDialog";
import { downloadFolder, folderSource, forgetFolderSource, pickFolderToShare } from "./shareFolder";
import { spaceFoldersApi, type SpaceFolder } from "./spaceFoldersApi";

function folderLine(folder: SpaceFolder): string {
  const files = folder.fileCount === 1 ? "1 file" : `${folder.fileCount} files`;
  return `${folder.uploadedBy.name} · ${formatBytes(folder.byteSize)} · ${files}`;
}

/**
 * The folders members shared into the Space: each with who uploaded it and when, and its size.
 * Share a folder picks one on this computer and uploads it; a row's ⋯ uploads its changes,
 * downloads it to this computer, or deletes it.
 */
export function SpaceFoldersSection({ spaceId }: { spaceId: string }) {
  const [folders, setFolders] = useState<SpaceFolder[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sharing, setSharing] = useState<{ localFolder: string; target?: SpaceFolder } | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  /** Downloads under way, by folder id, as a share from 0 to 1. */
  const [downloads, setDownloads] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirmDelete();
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  useEffect(() => {
    let live = true;
    setFolders(null);
    setLoadError("");
    spaceFoldersApi
      .list(spaceId)
      .then((result) => live && setFolders(result.folders))
      .catch((cause) => live && setLoadError(errorText(cause, "Try again in a moment.")));
    return () => {
      live = false;
    };
  }, [spaceId, attempt]);

  const pick = async (target?: SpaceFolder) => {
    if (picking) return;
    setPicking(true);
    setError("");
    try {
      const start = target ? folderSource(spaceId, target.id) : undefined;
      const localFolder = await pickFolderToShare(start);
      if (!localFolder) return;
      setSharing({ localFolder, target });
      setDialogOpen(true);
    } catch (cause) {
      setError(errorText(cause, "Misty couldn't open that folder."));
    } finally {
      setPicking(false);
    }
  };

  const shared = (folder: SpaceFolder) =>
    setFolders((current) => [folder, ...(current ?? []).filter((each) => each.id !== folder.id)]);

  const download = async (folder: SpaceFolder) => {
    if (folder.id in downloads) return;
    setDownloads((current) => ({ ...current, [folder.id]: 0 }));
    try {
      await downloadFolder(spaceId, folder, (progress) =>
        setDownloads((current) =>
          folder.id in current
            ? {
                ...current,
                [folder.id]:
                  progress.bytesTotal > 0
                    ? progress.bytesDone / progress.bytesTotal
                    : progress.total > 0
                      ? progress.done / progress.total
                      : 1,
              }
            : current,
        ),
      );
      notify({ message: `${folder.name} is on this computer.` });
    } catch (cause) {
      setError(errorText(cause, `${folder.name} couldn't be downloaded. Try again.`));
    } finally {
      setDownloads(({ [folder.id]: _done, ...rest }) => rest);
    }
  };

  const remove = (folder: SpaceFolder) =>
    void confirm({
      title: `Delete "${folder.name}"?`,
      what: "Its files are deleted from the Space for everyone. This can't be undone.",
      onConfirm: async () => {
        await spaceFoldersApi.remove(spaceId, folder.id);
        forgetFolderSource(spaceId, folder.id);
        setFolders((current) => (current ?? []).filter((each) => each.id !== folder.id));
      },
    });

  const hasFolders = Boolean(folders?.length);
  const shareButton = hasFolders ? (
    <Button
      type="button"
      variant="primary"
      icon={FolderUp}
      disabled={picking}
      onClick={() => void pick()}
    >
      Share a folder
    </Button>
  ) : undefined;

  return (
    <HomeSection title="Folders" count={folders?.length} action={shareButton} panel>
      {folders === null ? (
        loadError ? (
          <ErrorState
            inline
            title="Folders couldn't load"
            line={loadError}
            action={{ label: "Try again", onClick: () => setAttempt((count) => count + 1) }}
          />
        ) : (
          <ListRowSkeleton label="Shared folders" rows={2} lines={2} state />
        )
      ) : hasFolders ? (
        <div className="grid min-w-0">
          {folders.map((folder) => {
            const share = downloads[folder.id];
            const downloading = share !== undefined;
            return (
              <ListRow
                key={folder.id}
                label={folder.name}
                description={folderLine(folder)}
                state={downloading ? { kind: "none" } : { kind: "time", at: folder.uploadedAt }}
                trailing={
                  downloading ? (
                    <Text size="meta" tone="muted">
                      {`${Math.round(share * 100)}%`}
                    </Text>
                  ) : undefined
                }
                menuLabel={`Actions for ${folder.name}`}
                menu={
                  <>
                    <MenuItem
                      icon={FolderUp}
                      label="Upload changes"
                      disabled={picking}
                      onSelect={() => void pick(folder)}
                    />
                    <MenuItem
                      icon={Download}
                      label="Download"
                      disabled={downloading}
                      onSelect={() => void download(folder)}
                    />
                    <MenuSeparator />
                    <MenuItem icon={Trash2} label="Delete" danger onSelect={() => remove(folder)} />
                  </>
                }
              />
            );
          })}
        </div>
      ) : (
        <EmptyState
          inline
          title="No shared folders"
          line="Share a folder so everyone in the Space can use its files."
          action={{
            label: "Share a folder",
            icon: FolderUp,
            disabled: picking,
            onClick: () => void pick(),
          }}
        />
      )}
      {sharing ? (
        <ShareFolderDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          spaceId={spaceId}
          localFolder={sharing.localFolder}
          target={sharing.target}
          onShared={shared}
        />
      ) : null}
      {confirmDialog}
    </HomeSection>
  );
}
