// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import {
  Bot,
  Clock,
  Download,
  FileText,
  HardDrive,
  House,
  Monitor,
  Star,
  Trash2,
  Usb,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  ListRowSkeleton,
  Meter,
  NavList,
  NavRow,
  OverflowFadeText,
  SectionHeading,
  TagDot,
  Text,
  tagToneName,
} from "@misty/ui";
import { folderName, useProjectFolders } from "@/features/agents";
import {
  disk,
  type AgentTrashUsage,
  type Drive,
  type FinderTag,
  type FreeSpace,
  type Places,
} from "@/features/files";
import { SpaceDriveSection } from "../drive";
import { formatBytes } from "./format";
import { samePlace, type FilesPlace } from "./model";

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
  current: FilesPlace | null;
  here?: boolean;
  icon?: LucideIcon;
  mark?: ReactNode;
  label: string;
  end?: string;
  onGo(place: FilesPlace): void;
}) {
  return (
    <NavRow
      current={here ?? (current !== null && samePlace(place, current))}
      onClick={() => onGo(place)}
    >
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

function Section({
  id,
  title,
  folded,
  onFold,
  children,
}: {
  id: string;
  title: string;
  folded: readonly string[];
  onFold(section: string, fold: boolean): void;
  children: ReactNode;
}) {
  const open = !folded.includes(id);
  return (
    <section className="grid gap-1">
      <SectionHeading
        as="h3"
        strong
        title={title}
        open={open}
        onOpenChange={(next) => onFold(id, !next)}
        controls={`files-${id}`}
      />
      {open ? <div id={`files-${id}`}>{children}</div> : null}
    </section>
  );
}

function useRoomOn(path: string) {
  const [room, setRoom] = useState<FreeSpace | null>(null);
  useEffect(() => {
    let live = true;
    void disk.freeSpace(path).then(
      (space) => live && setRoom(space),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [path]);
  return room;
}

function DeviceRow({
  drive,
  current,
  onGo,
}: {
  drive: Drive;
  current: FilesPlace | null;
  onGo(place: FilesPlace): void;
}) {
  const room = useRoomOn(drive.path);
  const Icon = drive.removable ? Usb : HardDrive;
  const used = room ? Math.max(0, room.total - room.free) : 0;
  const here =
    current?.kind === "disk" &&
    (current.path === drive.path || current.path.startsWith(`${drive.path.replace(/\/$/, "")}/`));
  return (
    <NavRow tall current={here} onClick={() => onGo({ kind: "disk", path: drive.path })}>
      <Icon aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <OverflowFadeText full>{drive.name}</OverflowFadeText>
        {room && room.total > 0 ? (
          <>
            <Text size="meta" tone="muted">
              {`${formatBytes(used)} of ${formatBytes(room.total)} used`}
            </Text>
            <Meter label={`${drive.name} used`} share={used / room.total} />
          </>
        ) : null}
      </span>
    </NavRow>
  );
}

function ProjectRows({
  current,
  onGo,
}: {
  current: FilesPlace | null;
  onGo(place: FilesPlace): void;
}) {
  const projects = useProjectFolders();
  if (projects === null) return <ListRowSkeleton label="Projects" rows={3} />;
  return (
    <NavList>
      {projects.map((project) => (
        <PlaceRow
          key={project.path}
          place={{ kind: "project", root: project.path, path: project.path }}
          current={current}
          here={current?.kind === "project" && current.root === project.path}
          label={folderName(project.path)}
          onGo={onGo}
        />
      ))}
    </NavList>
  );
}

export function FilesSidebar({
  current,
  granted,
  picking,
  places,
  tags,
  agentTrash,
  macos,
  folded,
  onFold,
  onGo,
}: {
  current: FilesPlace | null;
  granted: boolean;
  picking: boolean;
  places: Places | null;
  tags: FinderTag[];
  agentTrash: AgentTrashUsage | null;
  macos: boolean;
  folded: readonly string[];
  onFold(section: string, fold: boolean): void;
  onGo(place: FilesPlace): void;
}) {
  const fixed: [string | undefined, string, LucideIcon][] = places
    ? [
        [places.home, "Home", House],
        [places.desktop, "Desktop", Monitor],
        [places.documents, "Documents", FileText],
        [places.downloads, "Downloads", Download],
      ]
    : [];
  const drivePlace =
    current?.kind === "space-drive" || current?.kind === "space-drive-trash" ? current : undefined;
  const sectionProps = { folded, onFold };

  return (
    <nav aria-label="Places" className="grid content-start gap-3">
      <SpaceDriveSection
        current={drivePlace}
        onGo={onGo}
        onGoTrash={picking ? undefined : onGo}
        open={!folded.includes("spaces")}
        onOpenChange={(next) => onFold("spaces", !next)}
      />
      {granted ? (
        <Section id="quick" title="Quick access" {...sectionProps}>
          <NavList>
            {fixed.map(([path, label, icon]) =>
              path ? (
                <PlaceRow
                  key={label}
                  place={{ kind: "disk", path }}
                  current={current}
                  icon={icon}
                  label={label}
                  onGo={onGo}
                />
              ) : null,
            )}
            <PlaceRow
              place={{ kind: "recent" }}
              current={current}
              icon={Clock}
              label="Recent"
              onGo={onGo}
            />
            <PlaceRow
              place={{ kind: "starred" }}
              current={current}
              icon={Star}
              label="Starred"
              onGo={onGo}
            />
            {!picking ? (
              <>
                <PlaceRow
                  place={{ kind: "trash" }}
                  current={current}
                  icon={Trash2}
                  label="Trash"
                  onGo={onGo}
                />
                <PlaceRow
                  place={{ kind: "agent-trash" }}
                  current={current}
                  icon={Bot}
                  label="Agent trash"
                  end={
                    agentTrash && agentTrash.items > 0 ? formatBytes(agentTrash.bytes) : undefined
                  }
                  onGo={onGo}
                />
              </>
            ) : null}
          </NavList>
        </Section>
      ) : (
        <Section id="projects" title="Projects" {...sectionProps}>
          <ProjectRows current={current} onGo={onGo} />
        </Section>
      )}
      {granted && macos && tags.length ? (
        <Section id="tags" title="Tags" {...sectionProps}>
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
        </Section>
      ) : null}
      {granted && places?.drives.length ? (
        <Section id="devices" title="Devices" {...sectionProps}>
          <NavList>
            {places.drives.map((drive) => (
              <DeviceRow key={drive.path} drive={drive} current={current} onGo={onGo} />
            ))}
          </NavList>
        </Section>
      ) : null}
    </nav>
  );
}
