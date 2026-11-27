import { Button, DialogFooter, EmptyState, SetupState, Spinner, Text } from "@misty/ui";
import { useAppStore } from "@/app/shell";
import { useSpacesStore } from "../list/use_spaces_store";
import { preferredDefaultSpace } from "../routes/default_space";
import type { FilePickChoice } from "./FilePickDialog";
import { FilesBrowser } from "./FilesBrowser";
import { localPath, placeFolder, type FileItem, type FilesPlace } from "./model";
import { useDiskGrant } from "./use_disk_grant";

const NOTHING: readonly string[] = [];

function folderTarget(picked: FileItem[], here: FilesPlace): string | undefined {
  if (picked.length === 1 && picked[0].folder) return localPath(picked[0]);
  if (picked.length === 0) return placeFolder(here);
  return undefined;
}

function PickFooter({
  choice,
  picked,
  here,
  busy,
  failure,
  open,
  onPick,
  onPickFolder,
  onCancel,
}: {
  choice: FilePickChoice;
  picked: FileItem[];
  here: FilesPlace;
  busy: boolean;
  failure: string;
  open(item: FileItem): void;
  onPick(items: FileItem[]): void;
  onPickFolder(path: string): void;
  onCancel(): void;
}) {
  const files = picked.filter((item) => !item.folder);
  const folder = picked.length === 1 && picked[0].folder ? picked[0] : undefined;
  const target = choice.folders ? folderTarget(picked, here) : undefined;
  const reachable = !choice.local || files.every((item) => localPath(item));
  const ready = choice.folders
    ? Boolean(target)
    : Boolean(folder) || (files.length > 0 && reachable);
  return (
    <DialogFooter className="px-6 pb-5 pt-3">
      <div className="mr-auto flex min-w-0 items-center gap-2">
        {busy ? <Spinner label="Opening files" /> : null}
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
        widthOf={["Open", "Choose"]}
        disabled={busy || !ready}
        onClick={() => {
          if (choice.folders) return target && onPickFolder(target);
          if (folder) return open(folder);
          onPick(files);
        }}
      >
        {choice.folders ? "Choose" : "Open"}
      </Button>
    </DialogFooter>
  );
}

export default function FilePickBody({
  choice,
  busy,
  failure,
  onPick,
  onPickFolder,
  onCancel,
}: {
  choice: FilePickChoice;
  busy: boolean;
  failure: string;
  onPick(items: FileItem[]): void;
  onPickFolder(path: string): void;
  onCancel(): void;
}) {
  const { grant, asking, check, ask } = useDiskGrant();
  const home = useAppStore((state) => state.app?.environment.homeDir) || undefined;
  const spaces = useSpacesStore((state) => state.spaces);
  const personal = preferredDefaultSpace(spaces);

  const granted = grant.status === "on";
  const asked = choice.start?.kind === "disk" && !granted ? undefined : choice.start;
  const start: FilesPlace | undefined =
    asked ??
    (granted
      ? choice.folders && home
        ? { kind: "disk", path: home }
        : { kind: "recent" }
      : personal
        ? { kind: "space-drive", spaceId: personal.id, path: "/" }
        : undefined);

  if (grant.status === "checking" || grant.status === "failed")
    return (
      <SetupState
        tool="files"
        label="Checking access to your files"
        error={grant.status === "failed" ? grant.message : null}
        onRetry={check}
      />
    );
  if (grant.status === "off" && choice.start?.kind !== "space-drive")
    return (
      <EmptyState
        title="Let Files open your disk"
        line="Misty asks your computer first. It never opens its own data, your keychains or system folders."
        action={{ label: "Allow access", onClick: ask, disabled: asking }}
      />
    );
  if (!start)
    return (
      <EmptyState
        title="No places to open"
        line="Join or make a Space, or add a project, to pick from its files."
      />
    );
  return (
    <FilesBrowser
      granted={granted}
      start={start}
      pick={{
        accept: choice.accept ?? NOTHING,
        multiple: Boolean(choice.multiple),
        folders: choice.folders,
        onPick,
      }}
      footer={(picked, open, here) => (
        <PickFooter
          choice={choice}
          picked={picked}
          here={here}
          busy={busy}
          failure={failure}
          open={open}
          onPick={onPick}
          onPickFolder={onPickFolder}
          onCancel={onCancel}
        />
      )}
    />
  );
}
