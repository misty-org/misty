import type { MountedDevice } from "@/native/ipc";
import { Download, FileText, HardDrive, Home, Monitor } from "lucide-react";
import { useMemo } from "react";

import { joinExplorerPath } from "@/shared/lib/pathNormalization";
import { cn, Pressable } from "@/shared/ui";

/** The picker's locations rail: Places and mounted devices, for navigation only. */

const quickAccessItems = [
  { label: "Home", icon: Home, suffix: "" },
  { label: "Desktop", icon: Monitor, suffix: "Desktop" },
  { label: "Documents", icon: FileText, suffix: "Documents" },
  { label: "Downloads", icon: Download, suffix: "Downloads" },
] as const;

export function PickerPlaces(props: PickerPlacesProps) {
  const quickAccess = useMemo(
    () =>
      quickAccessItems.map((item) => ({
        ...item,
        path: item.suffix ? joinExplorerPath(props.homePath, item.suffix) : props.homePath,
      })),
    [props.homePath],
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
      </PlacesSection>

      {props.devices.length > 0 ? (
        <PlacesSection label="Devices">
          {props.devices.map((device) => (
            <PlaceRow
              key={device.id}
              active={pathIsInside(props.activePath, device.mountPath)}
              icon={<HardDrive size={16} />}
              label={device.name}
              onSelect={() => props.onNavigate(device.mountPath)}
            />
          ))}
        </PlacesSection>
      ) : null}
    </nav>
  );
}

function PlacesSection({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section className="grid gap-0.5">
      <h3 className="px-2 pb-1 text-[11px] font-medium text-cream-muted">{label}</h3>
      {children}
    </section>
  );
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
    <Pressable
      className={cn("h-8 w-full gap-2 px-2", active && "bg-charcoal-hover text-cream")}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="shrink-0 text-cream-muted">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </Pressable>
  );
}

function pathIsInside(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, "") || "/";
  if (path === normalizedRoot) return true;
  if (normalizedRoot === "/") return false;
  return path.startsWith(`${normalizedRoot}/`);
}

export interface PickerPlacesProps {
  homePath: string;
  activePath: string;
  devices: MountedDevice[];
  onNavigate: (path: string) => void;
}
