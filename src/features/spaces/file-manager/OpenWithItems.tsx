import { useEffect, useState } from "react";
import { AppLogoImage, MenuItem, MenuSeparator, Skeleton } from "@misty/ui";
import { disk, type AppChoice } from "@/features/files";
import type { DriveEntry } from "../drive";
import type { DriveOpenApp } from "./useDriveOpenWith";

/**
 * Open with's rows for a file on the disk: the apps the computer says open it, its default first. They are
 * read when the submenu opens, which is when Radix mounts this.
 */
export function DiskOpenWithItems({ path, onOpen }: { path: string; onOpen(app: string): void }) {
  const [apps, setApps] = useState<AppChoice[] | null>(null);
  useEffect(() => {
    let live = true;
    void disk.appsFor(path).then(
      (found) => live && setApps(found),
      () => live && setApps([]),
    );
    return () => {
      live = false;
    };
  }, [path]);
  if (apps === null) return <Skeleton className="m-1 h-7" />;
  if (!apps.length) return <MenuItem label="No apps open this" disabled />;
  const ordered = [...apps.filter((app) => app.isDefault), ...apps.filter((app) => !app.isDefault)];
  return (
    <>
      {ordered.map((app, index) => (
        <div key={app.path} className="contents">
          <MenuItem label={app.isDefault ? `${app.name} (default)` : app.name} onSelect={() => onOpen(app.path)} />
          {index === 0 && app.isDefault && ordered.length > 1 ? <MenuSeparator /> : null}
        </div>
      ))}
    </>
  );
}

/** Open with's rows for a Space drive's file: the apps added to the Space that open its kind. */
export function DriveOpenWithItems({
  entry,
  apps,
  onOpen,
}: {
  entry: DriveEntry;
  apps: DriveOpenApp[];
  onOpen(entry: DriveEntry, appId: string): void;
}) {
  if (!apps.length) return <MenuItem label="No apps in this Space open this" disabled />;
  return (
    <>
      {apps.map((app) => (
        <MenuItem
          key={app.id}
          icon={<AppLogoImage src={app.logo || undefined} name={app.name} size="row" />}
          label={app.name}
          onSelect={() => onOpen(entry, app.id)}
        />
      ))}
    </>
  );
}
