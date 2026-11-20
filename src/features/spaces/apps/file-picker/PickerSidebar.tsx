import { FolderPlus } from "lucide-react";
import {
  NavList,
  NavRow,
  OverflowFadeText,
  SectionHeading,
  Skeleton,
  spaceIcons,
} from "@misty/ui";
import { folderName, type ProjectFolder } from "@/features/agents";
import { spaceDriveRoot, type PickerPlace } from "./pickerPlaces";

const FilesIcon = spaceIcons.files;

/**
 * The picker's places, as Finder's sidebar lists them: the Space's Files, its drive (when choosing
 * for an app), then the person's projects on this computer, the only folders Misty may read. Add folder
 * grants another one in the system's own dialog.
 */
export function PickerSidebar({
  place,
  driveSpaceId,
  projects,
  onGo,
  onAddFolder,
}: {
  place: PickerPlace;
  /** The Space whose drive is one of the places, when it is. */
  driveSpaceId?: string;
  /** Null while they load. */
  projects: ProjectFolder[] | null;
  onGo(place: PickerPlace): void;
  onAddFolder(): void;
}) {
  return (
    <nav aria-label="Places" className="grid content-start gap-4">
      {driveSpaceId ? (
        <NavList>
          <NavRow
            tone="page"
            current={place.kind === "space-drive"}
            onClick={() => onGo(spaceDriveRoot(driveSpaceId))}
          >
            <FilesIcon aria-hidden="true" />
            <OverflowFadeText>Files</OverflowFadeText>
          </NavRow>
        </NavList>
      ) : null}
      <div className="grid gap-1">
        <SectionHeading
          as="h3"
          title="On this computer"
          action={{ label: "Add folder", icon: FolderPlus, onSelect: onAddFolder }}
        />
        {projects === null ? (
          <div className="grid gap-1.5" aria-label="Folders" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-8 w-full rounded-md" />
            ))}
          </div>
        ) : (
          <NavList>
            {projects.map((project) => (
              <NavRow
                key={project.path}
                tone="page"
                current={place.kind === "folder" && place.root === project.path}
                onClick={() => onGo({ kind: "folder", root: project.path, path: project.path })}
              >
                <OverflowFadeText>{folderName(project.path)}</OverflowFadeText>
              </NavRow>
            ))}
          </NavList>
        )}
      </div>
    </nav>
  );
}
