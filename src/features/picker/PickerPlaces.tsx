import type { PickerPlacesProps } from "@/models/interfaces/features/picker/PickerPlaces";
export type { PickerPlacesProps } from "@/models/interfaces/features/picker/PickerPlaces";
import { Download, FileText, Folder, HardDrive, Home, Monitor } from "lucide-react";
import { useMemo } from "react";

import { AssetIcon, Button, cn } from "@/ui";
import { providerIconForType } from "@/assets/icons";
import {
  buildDeviceEntries,
  dedupePinnedPathsForQuickAccess,
  joinPath,
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  pathIsInside,
  pinnedPathLabel,
  quickAccessPathHidden,
} from "../explorer/components/ExplorerSidebarSupport";

/**
 * The picker's locations rail: the explorer sidebar reduced to navigation only — no workspace
 * switcher, collapsible sections, capacity meters, or per-device customization.
 */

const quickAccessItems = [
  { label: "Home", icon: Home, suffix: "" },
  { label: "Desktop", icon: Monitor, suffix: "Desktop" },
  { label: "Documents", icon: FileText, suffix: "Documents" },
  { label: "Downloads", icon: Download, suffix: "Downloads" },
] as const;

export function PickerPlaces(props: PickerPlacesProps) {
  const hiddenQuickAccessPaths = useMemo(loadHiddenQuickAccessPaths, []);
  const quickAccess = useMemo(
    () =>
      quickAccessItems
        .map((item) => ({
          ...item,
          path: item.suffix ? joinPath(props.homePath, item.suffix) : props.homePath,
        }))
        .filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths)),
    [hiddenQuickAccessPaths, props.homePath],
  );
  const pinned = useMemo(
    () =>
      dedupePinnedPathsForQuickAccess(
        props.pinnedPaths,
        quickAccess.map((item) => item.path),
      ),
    [props.pinnedPaths, quickAccess],
  );
  const devices = useMemo(
    () => buildDeviceEntries(props.devices, loadDeviceCustomization()),
    [props.devices],
  );

  return (
    <nav className="flex min-h-0 flex-col gap-4 overflow-y-auto p-2" aria-label="Locations">
      <PlacesSection label="Places">
        {quickAccess.map((item) => (
          <PlaceRow
            key={item.path}
            active={props.activePath === item.path}
            icon={<item.icon size={16} />}
            label={item.label}
            onSelect={() => props.onNavigate(item.path)}
          />
        ))}
        {pinned.map((path) => (
          <PlaceRow
            key={path}
            active={props.activePath === path}
            icon={<Folder size={16} />}
            label={pinnedPathLabel(path)}
            onSelect={() => props.onNavigate(path)}
          />
        ))}
      </PlacesSection>

      {props.remotes.length > 0 || props.remoteLoading ? (
        <PlacesSection label="Remotes">
          {props.remotes.length === 0 ? (
            <PlacesHint>Loading…</PlacesHint>
          ) : (
            props.remotes.map((remote) => {
              const path = joinPath(props.mountRoot, remote.name);
              const icon = providerIconForType(remote.type);
              return (
                <PlaceRow
                  key={`${remote.type}:${remote.name}`}
                  active={props.activePath === path || props.activePath.startsWith(`${path}/`)}
                  icon={<AssetIcon src={icon.src} color={icon.color} size={16} />}
                  label={remote.name}
                  onSelect={() => props.onNavigate(path)}
                />
              );
            })
          )}
        </PlacesSection>
      ) : null}

      {devices.length > 0 || props.devicesLoading ? (
        <PlacesSection label="Devices">
          {devices.length === 0 ? (
            <PlacesHint>Loading…</PlacesHint>
          ) : (
            devices.map((device) => (
              <PlaceRow
                key={device.id}
                active={pathIsInside(props.activePath, device.mountPath)}
                icon={<HardDrive size={16} />}
                label={device.name}
                onSelect={() => props.onNavigate(device.mountPath)}
              />
            ))
          )}
        </PlacesSection>
      ) : null}
    </nav>
  );
}

function PlacesSection({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section className="grid gap-0.5">
      <h3 className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

function PlacesHint({ children }: { children: React.ReactNode }) {
  return <p className="m-0 px-2 py-1 text-xs text-muted-foreground">{children}</p>;
}

function PlaceRow({
  active,
  icon,
  label,
  onSelect,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Button
      className={cn(
        "h-8 w-full justify-start gap-2 px-2 font-normal shadow-none",
        active && "bg-accent text-accent-foreground",
      )}
      variant="ghost"
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );
}
