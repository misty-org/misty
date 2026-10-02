import { useEffect, useMemo, useState } from "react";
import { Archive, CircleCheck, Clock, LayoutPanelTop } from "lucide-react";
import type { WorkspaceWindow } from "@/features/workspace/model";
import type { NativeSyncView } from "../native";
import { unsyncedTabRows, type UnsyncedTabRow } from "../unsyncedTabs";

const detail: Record<UnsyncedTabRow["state"], string> = {
  waiting: "Waiting to sync",
  closed: "Closed · waiting to sync",
  arrangement: "Waiting to sync",
  kept: "Kept on this device · not synced",
};

/** Open windows, for naming tabs. Loaded on demand: the store pulls in the
 * whole workspace, which the sync popup otherwise never needs. */
function useOpenWindows(): WorkspaceWindow[] {
  const [windows, setWindows] = useState<WorkspaceWindow[]>([]);
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void import("@/features/workspace/useWorkspaceStore")
      .then(({ useWorkspaceStore }) => {
        if (!live) return;
        const read = ({ windowsByScope }: ReturnType<typeof useWorkspaceStore.getState>) =>
          setWindows(Object.values(windowsByScope).flatMap((list) => list ?? []));
        read(useWorkspaceStore.getState());
        stop = useWorkspaceStore.subscribe(read);
      })
      // Without the store, rows keep the titles native sent.
      .catch(() => undefined);
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return windows;
}

/** What has not synced yet, per tab. Everything not listed is synced. */
export function SyncedTabsStatusList({ session }: { session: NativeSyncView }) {
  const waiting = Boolean(session.sync?.unsynced?.length || session.sync?.retired_edits);
  return waiting ? <UnsyncedTabs session={session} /> : null;
}

function UnsyncedTabs({ session }: { session: NativeSyncView }) {
  const windows = useOpenWindows();
  const rows = useMemo(() => unsyncedTabRows(session.sync, windows), [session.sync, windows]);
  if (!rows.length) return null;
  return (
    <section aria-label="Synced across devices" className="border-t border-charcoal-border py-3">
      <h2 className="pb-2 text-xs font-medium text-cream-muted">Synced across devices</h2>
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            {row.state === "kept" ? (
              <Archive aria-hidden className="size-4 shrink-0 text-cream-muted" />
            ) : row.state === "arrangement" ? (
              <LayoutPanelTop aria-hidden className="size-4 shrink-0 text-cream-muted" />
            ) : (
              <Clock aria-hidden className="size-4 shrink-0 text-cream-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate" title={row.title}>
                {row.title}
              </div>
              <div className="text-xs text-cream-muted">{detail[row.state]}</div>
            </div>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-cream" />
          <div className="min-w-0 flex-1 text-xs text-cream-muted">Everything else is synced</div>
        </li>
      </ul>
    </section>
  );
}
