import { NavList, NavRow, OverflowFadeText, SectionHeading, Skeleton, StateMark } from "@misty/ui";
import type { SpaceDrivePlace } from "../apps/file-picker/picker_places";
import { SpaceAvatar } from "../components/SpaceAvatar";
import { useSpacesStore } from "../list/use_spaces_store";
import { preferredDefaultSpace, spaceNavigationName } from "../routes/default_space";
import type { DriveSpaceStatus } from "./drive_native";
import { useDriveStatus } from "./use_drive";

function DriveStatusMark({ status }: { status?: DriveSpaceStatus }) {
  if (status?.status === "syncing") return <StateMark kind="working" label="Syncing" />;
  return null;
}

export function SpaceDriveSection({
  current,
  onGo,
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  current?: SpaceDrivePlace;
  onGo: (place: SpaceDrivePlace) => void;
}) {
  const drive = useDriveStatus();
  const spaces = useSpacesStore((state) => state.spaces);
  const snapshotReady = useSpacesStore((state) => state.snapshotReady);
  const personal = preferredDefaultSpace(spaces);
  const ordered = personal ? [personal, ...spaces.filter((space) => space !== personal)] : spaces;
  const mounted = drive.failed ? ordered : ordered.filter((space) => space.id in drive.bySpace);
  const loading = !snapshotReady || (!drive.ready && !drive.failed);

  return (
    <div className="grid gap-1">
      <SectionHeading
        as="h3"
        title="Spaces"
        strong={open !== undefined}
        open={open}
        onOpenChange={onOpenChange}
      />
      {open === false ? null : loading ? (
        <div className="grid gap-1.5" aria-label="Spaces" aria-busy="true">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-8 w-full rounded-md" />
          ))}
        </div>
      ) : (
        <NavList>
          {mounted.map((space) => {
            const here = current?.spaceId === space.id;
            const name = spaceNavigationName(space);
            return (
              <NavRow
                key={space.id}
                current={here}
                onClick={() => onGo({ kind: "space-drive", spaceId: space.id, path: "/" })}
                data-collection-place={JSON.stringify({
                  kind: "space-drive",
                  spaceId: space.id,
                  path: "/",
                })}
              >
                <SpaceAvatar
                  space={space}
                  className="size-4 shrink-0 rounded-sm"
                  fallbackClassName="text-micro font-semibold"
                />
                <OverflowFadeText full className="min-w-0 flex-1">
                  {name}
                </OverflowFadeText>
                <DriveStatusMark status={drive.bySpace[space.id]} />
              </NavRow>
            );
          })}
        </NavList>
      )}
    </div>
  );
}
