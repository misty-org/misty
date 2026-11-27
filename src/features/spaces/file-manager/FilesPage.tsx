import { EmptyState, SetupState } from "@misty/ui";
import { useSpacesStore } from "../list/use_spaces_store";
import { preferredDefaultSpace } from "../routes/default_space";
import { FilesBrowser } from "./FilesBrowser";
import type { FilesPlace } from "./model";
import { useDiskGrant } from "./use_disk_grant";

export function FilesPage() {
  const { grant, asking, check, ask } = useDiskGrant();
  const spaces = useSpacesStore((state) => state.spaces);
  const personal = preferredDefaultSpace(spaces);

  if (grant.status === "checking" || grant.status === "failed")
    return (
      <SetupState
        tool="files"
        label="Checking access to your files"
        error={grant.status === "failed" ? grant.message : null}
        onRetry={check}
      />
    );
  if (grant.status === "off")
    return (
      <EmptyState
        title="Let Files open your disk"
        line="Misty asks your computer first. It never opens its own data, your keychains or system folders."
        action={{ label: "Allow access", onClick: ask, disabled: asking }}
      />
    );
  const granted = grant.status === "on";
  const start: FilesPlace | undefined = granted
    ? { kind: "recent" }
    : personal
      ? { kind: "space-drive", spaceId: personal.id, path: "/" }
      : undefined;
  if (!start)
    return (
      <EmptyState
        title="No places to open"
        line="Join or make a Space, or add a project, to see its files here."
      />
    );
  return <FilesBrowser granted={granted} start={start} />;
}
