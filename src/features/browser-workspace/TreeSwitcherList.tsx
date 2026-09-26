import { ArrowRightLeft, Check, Laptop, LoaderCircle, Monitor } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { useUserStore } from "@/features/auth/core";
import type { NativeSyncView, SyncTreeView } from "./native";
import { seatText, treeRows } from "./treeControl";

type Pending = { deviceId: string; fullSync: boolean | null } | null;

/** Every device's workspace, who is using it, and a way to continue there. */
export function TreeSwitcherList({
  session,
  trees,
  pending,
  onSwitch,
  onFullSync,
}: {
  session: NativeSyncView;
  trees: SyncTreeView;
  pending: Pending;
  onSwitch: (deviceId: string) => void;
  onFullSync: (deviceId: string, enabled: boolean) => void;
}) {
  const ownerName = useUserStore((state) => state.me?.name);
  const fullSyncOf = (id: string) =>
    session.devices?.find((device) => device.device_id === id)?.full_sync ?? true;
  const controllable = (id: string) =>
    (session.devices?.find((device) => device.device_id === id)?.control_version ?? 0) >= 1;
  return (
    <ul className="divide-y divide-charcoal-border">
      {treeRows(session, trees, ownerName).map((row) => {
        const switching = pending?.deviceId === row.deviceId && pending.fullSync === null;
        const Icon = row.os.startsWith("macOS") ? Laptop : Monitor;
        return (
          <li key={row.deviceId} className="py-3">
            <div className="flex items-center gap-3">
              <Icon className="size-4 shrink-0 text-cream-muted" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium" title={row.name}>
                    {row.name}
                  </span>
                  {row.local && (
                    <span className="shrink-0 rounded-full border border-charcoal-border px-1.5 text-[11px] leading-4 text-cream-muted">
                      This device
                    </span>
                  )}
                </div>
                <div className="truncate text-cream-muted">
                  {[row.os, seatText(row)].filter(Boolean).join(" · ")}
                </div>
              </div>
              {row.seat === "you" ? (
                <span
                  role="img"
                  aria-label={`Using ${row.name}'s workspace`}
                  title="Using this workspace"
                  className="flex size-8 shrink-0 items-center justify-center text-cream"
                >
                  <Check aria-hidden className="size-4" />
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-8 shrink-0 p-0"
                  disabled={Boolean(pending) || !row.canSwitch}
                  onClick={() => onSwitch(row.deviceId)}
                  aria-label={`Continue on ${row.name}'s workspace`}
                  title={
                    row.seat === "other"
                      ? `Take over from ${row.seatName}`
                      : `Continue on ${row.name}'s workspace`
                  }
                  aria-busy={switching}
                >
                  {switching ? (
                    <>
                      <LoaderCircle
                        aria-hidden
                        className="size-4 animate-spin motion-reduce:animate-none"
                      />
                      <span className="sr-only">Switching…</span>
                    </>
                  ) : (
                    <ArrowRightLeft aria-hidden className="size-4" />
                  )}
                </Button>
              )}
              <span className="flex w-14 shrink-0 justify-center">
                <Switch
                  checked={fullSyncOf(row.deviceId)}
                  disabled={
                    Boolean(pending) ||
                    row.connection !== "Connected" ||
                    !controllable(row.deviceId)
                  }
                  aria-label={`Full sync for ${row.name}`}
                  onCheckedChange={(checked) => onFullSync(row.deviceId, checked)}
                />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
