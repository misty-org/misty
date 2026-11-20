import { Trash2 } from "lucide-react";
import { NavList, NavRow, OverflowFadeText, SectionHeading, Skeleton, StateMark } from "@misty/ui";
import type { SpaceDrivePlace, SpaceDriveTrashPlace } from "../apps/file-picker/pickerPlaces";
import { SpaceAvatar } from "../components/SpaceAvatar";
import { useSpacesStore } from "../list/useSpacesStore";
import { preferredDefaultSpace, spaceNavigationName } from "../routes/defaultSpace";
import type { DriveSpaceStatus } from "./driveNative";
import { useDriveStatus } from "./useDrive";

/** The mark at a drive's row end: only while it syncs or after it failed. */
function DriveStatusMark({ status }: { status?: DriveSpaceStatus }) {
  if (status?.status === "syncing") return <StateMark kind="working" label="Syncing" />;
  if (status?.status === "failed")
    return (
      <StateMark
        kind="failed"
        label={status.message ? `Couldn't sync: ${status.message}` : "Couldn't sync"}
      />
    );
  return null;
}

/** A Space's trash, as a row of Files' sidebar. */
export function SpaceDriveTrashRow({
  spaceId,
  current,
  onGo,
}: {
  spaceId: string;
  /** The trash is the open place. */
  current?: boolean;
  onGo: (place: SpaceDriveTrashPlace) => void;
}) {
  return (
    <NavRow
      tone="page"
      current={current}
      onClick={() => onGo({ kind: "space-drive-trash", spaceId })}
    >
      <Trash2 aria-hidden="true" />
      <OverflowFadeText>Trash</OverflowFadeText>
    </NavRow>
  );
}

/**
 * Files' Spaces section: one row per Space drive mounted on this computer (the person's own Space
 * first), each with the Space's picture, its name, and a mark at its end while it syncs or after it
 * failed (with the reason in the mark's tooltip). A row opens the drive's root. With `onGoTrash`,
 * the open Space's Trash shows as a row right under its drive, so the list stays one row per Space.
 */
export function SpaceDriveSection({
  current,
  onGo,
  onGoTrash,
}: {
  /** The open place, when it is a Space drive's folder or trash. */
  current?: SpaceDrivePlace | SpaceDriveTrashPlace;
  onGo: (place: SpaceDrivePlace) => void;
  onGoTrash?: (place: SpaceDriveTrashPlace) => void;
}) {
  const drive = useDriveStatus();
  const spaces = useSpacesStore((state) => state.spaces);
  const snapshotReady = useSpacesStore((state) => state.snapshotReady);
  const personal = preferredDefaultSpace(spaces);
  const ordered = personal ? [personal, ...spaces.filter((space) => space !== personal)] : spaces;
  // The drives native mounted; if their status can't be read, every Space of the person's still shows.
  const mounted = drive.failed ? ordered : ordered.filter((space) => space.id in drive.bySpace);
  const loading = !snapshotReady || (!drive.ready && !drive.failed);

  return (
    <div className="grid gap-1">
      <SectionHeading as="h3" title="Spaces" />
      {loading ? (
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
              <div key={space.id} className="contents">
                <NavRow
                  tone="page"
                  current={here && current?.kind === "space-drive"}
                  onClick={() => onGo({ kind: "space-drive", spaceId: space.id, path: "/" })}
                >
                  <SpaceAvatar
                    space={space}
                    className="size-4 shrink-0 rounded-sm"
                    fallbackClassName="text-3xs font-semibold"
                  />
                  <OverflowFadeText full className="min-w-0 flex-1">
                    {name}
                  </OverflowFadeText>
                  <DriveStatusMark status={drive.bySpace[space.id]} />
                </NavRow>
                {here && onGoTrash ? (
                  <SpaceDriveTrashRow
                    spaceId={space.id}
                    current={current?.kind === "space-drive-trash"}
                    onGo={onGoTrash}
                  />
                ) : null}
              </div>
            );
          })}
        </NavList>
      )}
    </div>
  );
}
