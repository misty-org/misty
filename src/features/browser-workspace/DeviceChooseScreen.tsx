import { BlockingScreen, Button, Spinner } from "@/shared/ui";
import misty from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import mistyStill from "@/shared/assets/agents/cloud-sky-poster.webp?inline";
import { useUserStore } from "@/features/auth/core";
import type { NativeSyncView, SyncTreeView } from "./native";
import { treeRows, type TreeRow } from "./treeControl";

/** Shown when another device took this device's seat: take a workspace back. */
export function DeviceChooseScreen({
  session,
  trees,
  busyTree,
  error,
  onChoose,
}: {
  session: NativeSyncView;
  trees: SyncTreeView;
  busyTree: string | null;
  error: string | null;
  onChoose: (treeId: string) => void;
}) {
  const ownerName = useUserStore((state) => state.me?.name);
  const rows = treeRows(session, trees, ownerName);
  const local = rows.find((row) => row.local);
  const others = rows.filter((row) => !row.local);
  const button = (row: TreeRow, label: string, variant: "primary" | "outline") => (
    <Button
      variant={variant}
      size="lg"
      className="w-full justify-center"
      disabled={Boolean(busyTree) || !row.canSwitch}
      aria-busy={busyTree === row.deviceId}
      onClick={() => onChoose(row.deviceId)}
    >
      {busyTree === row.deviceId ? <Spinner label="Switching…" /> : null}
      <span className="truncate">{label}</span>
    </Button>
  );
  return (
    <BlockingScreen
      attributes={{ "data-device-sync-choose": "" }}
      media={
        <picture className="mb-6">
          <source media="(prefers-reduced-motion: reduce)" srcSet={mistyStill} />
          <img
            src={misty}
            alt=""
            width={176}
            height={176}
            draggable={false}
            className="size-44 select-none object-contain"
          />
        </picture>
      }
      title="Misty is sleeping here"
      description={
        local?.seatName ? `Your workspace is open on ${local.seatName}.` : "Pick where to continue."
      }
    >
      {trees.displaced_with_edits && (
        <p className="mt-2 max-w-xs text-sm text-cream-muted">
          Unsent changes are kept on this device.
        </p>
      )}
      <div className="mt-6 w-full max-w-xs space-y-2">
        {local && button(local, "Continue here", "primary")}
        {others.map((row) => (
          <div key={row.deviceId}>{button(row, `Open ${row.name}`, "outline")}</div>
        ))}
      </div>
      <div className="mt-4 min-h-10 max-w-xs text-sm" aria-live="polite">
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
      </div>
    </BlockingScreen>
  );
}
