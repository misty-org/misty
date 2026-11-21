import { AppWindow, Bot, Clock, Download, FileText, HardDrive, House, Monitor, Star, Trash2, Usb, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ListRowSkeleton,
  NavList,
  NavRow,
  OverflowFadeText,
  SectionHeading,
  TagDot,
  Text,
  tagToneName,
} from "@misty/ui";
import { folderName, useProjectFolders } from "@/features/agents";
import type { AgentTrashUsage, FinderTag, Places } from "@/features/files";
import { SpaceDriveSection } from "../drive";
import { formatBytes } from "./format";
import { samePlace, type FilesPlace } from "./model";

/** One place in the sidebar: its icon (when it has one of its own), its name and what sits at its end. */
function PlaceRow({
  place,
  current,
  here,
  icon: Icon,
  mark,
  label,
  end,
  onGo,
}: {
  place: FilesPlace;
  current: FilesPlace;
  /** Overrides whether it is the open place, for a row that stands for everything under it. */
  here?: boolean;
  icon?: LucideIcon;
  mark?: ReactNode;
  label: string;
  end?: string;
  onGo(place: FilesPlace): void;
}) {
  return (
    <NavRow tone="page" current={here ?? samePlace(place, current)} onClick={() => onGo(place)}>
      {Icon ? <Icon aria-hidden="true" /> : mark}
      <OverflowFadeText full className="min-w-0 flex-1">
        {label}
      </OverflowFadeText>
      {end ? (
        <Text size="meta" tone="muted">
          {end}
        </Text>
      ) : null}
    </NavRow>
  );
}

/** The person's projects, all Files reaches on this computer while the disk grant is off. */
function ProjectRows({ current, onGo }: { current: FilesPlace; onGo(place: FilesPlace): void }) {
  const projects = useProjectFolders();
  return (
    <div className="grid gap-1">
      <SectionHeading as="h3" title="Projects" />
      {projects === null ? (
        <ListRowSkeleton label="Projects" rows={3} />
      ) : (
        <NavList>
          {projects.map((project) => (
            <PlaceRow
              key={project.path}
              place={{ kind: "project", root: project.path, path: project.path }}
              current={current}
              here={current.kind === "project" && current.root === project.path}
              label={folderName(project.path)}
              onGo={onGo}
            />
          ))}
        </NavList>
      )}
    </div>
  );
}

/**
 * Files' sidebar, as Finder's: Recent, Starred and the fixed places, the drives, the Space drives (each
 * with its trash under it while it is open), Finder's tags (macOS), then Misty's Trash and Agent trash
 * with how much it holds. Without the disk grant it lists the Space drives and the person's projects.
 */
export function FilesSidebar({
  current,
  granted,
  picking,
  places,
  tags,
  agentTrash,
  macos,
  onGo,
}: {
  current: FilesPlace;
  granted: boolean;
  picking: boolean;
  places: Places | null;
  tags: FinderTag[];
  agentTrash: AgentTrashUsage | null;
  macos: boolean;
  onGo(place: FilesPlace): void;
}) {
  const fixed: [string | undefined, string, LucideIcon][] = places
    ? [
        [places.home, "Home", House],
        [places.desktop, "Desktop", Monitor],
        [places.documents, "Documents", FileText],
        [places.downloads, "Downloads", Download],
        [places.applications, "Applications", AppWindow],
      ]
    : [];
  const drivePlace = current.kind === "space-drive" || current.kind === "space-drive-trash" ? current : undefined;

  return (
    <nav aria-label="Places" className="grid content-start gap-4">
      {granted ? (
        <NavList>
          <PlaceRow place={{ kind: "recent" }} current={current} icon={Clock} label="Recent" onGo={onGo} />
          <PlaceRow place={{ kind: "starred" }} current={current} icon={Star} label="Starred" onGo={onGo} />
          {fixed.map(([path, label, icon]) =>
            path ? (
              <PlaceRow key={label} place={{ kind: "disk", path }} current={current} icon={icon} label={label} onGo={onGo} />
            ) : null,
          )}
        </NavList>
      ) : (
        <ProjectRows current={current} onGo={onGo} />
      )}
      {granted && places?.drives.length ? (
        <div className="grid gap-1">
          <SectionHeading as="h3" title="Drives" />
          <NavList>
            {places.drives.map((drive) => (
              <PlaceRow
                key={drive.path}
                place={{ kind: "disk", path: drive.path }}
                current={current}
                icon={drive.removable ? Usb : HardDrive}
                label={drive.name}
                onGo={onGo}
              />
            ))}
          </NavList>
        </div>
      ) : null}
      <SpaceDriveSection current={drivePlace} onGo={onGo} onGoTrash={picking ? undefined : onGo} />
      {granted && macos && tags.length ? (
        <div className="grid gap-1">
          <SectionHeading as="h3" title="Tags" />
          <NavList>
            {tags.map((tag) => (
              <PlaceRow
                key={tag.name}
                place={{ kind: "tag", name: tag.name, color: tag.color }}
                current={current}
                mark={<TagDot color={tag.color} label={tagToneName(tag.color)} />}
                label={tag.name}
                onGo={onGo}
              />
            ))}
          </NavList>
        </div>
      ) : null}
      {granted && !picking ? (
        <NavList>
          <PlaceRow place={{ kind: "trash" }} current={current} icon={Trash2} label="Trash" onGo={onGo} />
          <PlaceRow
            place={{ kind: "agent-trash" }}
            current={current}
            icon={Bot}
            label="Agent trash"
            end={agentTrash && agentTrash.items > 0 ? formatBytes(agentTrash.bytes) : undefined}
            onGo={onGo}
          />
        </NavList>
      ) : null}
    </nav>
  );
}
