import { Button, cn } from "@/shared/ui";
import { popupSurfaceClass } from "@/shared/ui/overlays/popupStyles";
import { ChevronRight, CircleCheck, Monitor } from "lucide-react";
import { devices, sites, type SiteId } from "../../data/project";
import type { AppState } from "../../film/state";
import { Spin } from "../Spin";

// Compact roster rows: one label each (This device, Open here, connection
// state or Opening…) and a right-aligned Open button.
function DeviceRow(props: { name: string; label: string; disabled: boolean; t?: string; pressed?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Monitor aria-hidden className="size-4 shrink-0 text-cream-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-cream">{props.name}</p>
        <p className="mt-0.5 text-xs leading-4 text-cream-muted" data-t={props.t ? `${props.t}-label` : undefined}>
          {props.label}
        </p>
      </div>
      <Button
        data-t={props.t}
        size="sm"
        variant="outline"
        disabled={props.disabled}
        className={cn("shrink-0 px-2 text-xs", props.pressed && "bg-charcoal-hover text-cream-bright")}
      >
        Open
      </Button>
    </li>
  );
}

// Restore order and outcome per tab. The sign-in page restores everything
// except its password, which page restore never carries.
const restoring: { site: SiteId; at: number; secrets?: number }[] = [
  { site: "staging", at: 0.45 },
  { site: "cms", at: 0.7, secrets: 1 },
  { site: "images", at: 0.85 },
  { site: "checklist", at: 1 },
];

function RestoreList({ progress }: { progress: number }) {
  const active = restoring.some((tab) => progress < tab.at);
  return (
    <section className="mx-3 border-t border-charcoal-border py-3" data-t="restore-list">
      <h2 className="pb-2 text-sm font-medium text-cream">{active ? "Restoring pages" : "Page restore results"}</h2>
      <ul className="space-y-2 text-sm">
        {restoring.map((tab) => {
          const done = progress >= tab.at;
          return (
            <li key={tab.site} className="flex items-center gap-2">
              {done ? <CircleCheck aria-hidden className="size-4 shrink-0 text-cream" /> : <Spin t={progress * 4} />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-cream">{sites[tab.site].title}</div>
                <div className="text-xs text-cream-muted">
                  {!done
                    ? "Restoring…"
                    : tab.secrets
                      ? `Restored · ${tab.secrets} private field to fill again`
                      : "Restored"}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SyncPopup({ state, height }: { state: AppState; height: number }) {
  const sync = state.sync!;
  const opened = sync.restore !== undefined;
  const local = state.device === "laptop" ? devices.laptop : devices.desktop;
  const remote = state.device === "laptop" ? devices.desktop : devices.laptop;
  return (
    <div
      data-t="sync-popup"
      className={cn(popupSurfaceClass, "absolute left-[62px] z-50 w-88 p-1.5")}
      style={{ bottom: Math.max(14, height - 900 + 14) }}
    >
      <ul>
        <DeviceRow name={local} label={opened ? `This device · Viewing ${remote}` : "This device"} disabled />
        <DeviceRow
          t="sync-open-remote"
          name={remote}
          label={sync.opening && !opened ? "Opening…" : opened ? "Open here" : "Online"}
          disabled={opened || !!sync.opening}
          pressed={sync.opening && !opened}
        />
      </ul>
      {opened && <RestoreList progress={sync.restore!} />}
      <div className="mt-1 border-t border-charcoal-border pt-1">
        <span className="flex h-9 w-full items-center justify-between rounded-md px-3 text-sm text-cream-muted">
          Manage sync
          <ChevronRight aria-hidden className="size-4" />
        </span>
      </div>
    </div>
  );
}
