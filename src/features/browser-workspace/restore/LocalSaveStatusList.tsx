import { CircleAlert, CircleCheck, Clock, FileX } from "lucide-react";
import { Button } from "@/shared/ui";
import {
  restoreNativeWorkspace,
  useWorkspaceRecoveryState,
} from "@/features/workspace/nativeWorkspaceRecovery";

/** Recovery keys as people know them. Several keys can share one row. */
function label(key: string) {
  if (key === "workspace") return "Windows and tabs";
  if (key === "before-sync") return "Workspace before sync";
  if (key.startsWith("archive:")) return "Preserved original copies";
  if (key.startsWith("edits:"))
    return key.includes(":retired:")
      ? "Earlier tab changes kept for recovery"
      : "Tab changes waiting to sync";
  return "Workspace data";
}

type Row = { label: string; state: "saved" | "waiting" | "failed"; detail?: string };

/** What this device saved, what waits, and what did not come back on restore. */
export function LocalSaveStatusList() {
  const { accountId, saves, notRestored } = useWorkspaceRecoveryState();
  if (!saves.pending.length && !saves.failed.length && !notRestored.length) return null;
  const rows = new Map<string, Row>();
  rows.set("Windows and tabs", { label: "Windows and tabs", state: "saved" });
  for (const key of saves.pending) rows.set(label(key), { label: label(key), state: "waiting" });
  for (const { key, error } of saves.failed)
    rows.set(label(key), { label: label(key), state: "failed", detail: error });
  return (
    <section aria-label="Saved on this device" className="border-t border-charcoal-border py-3">
      <h2 className="pb-2 text-xs font-medium text-cream-muted">Saved on this device</h2>
      <ul className="space-y-2 text-sm">
        {[...rows.values()].map((row) => (
          <li key={row.label} className="flex items-center gap-2" title={row.detail}>
            {row.state === "saved" ? (
              <CircleCheck aria-hidden className="size-4 shrink-0 text-cream" />
            ) : row.state === "waiting" ? (
              <Clock aria-hidden className="size-4 shrink-0 text-cream-muted" />
            ) : (
              <CircleAlert aria-hidden className="size-4 shrink-0 text-cream-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate">{row.label}</div>
              <div className="text-xs text-cream-muted">
                {row.state === "saved"
                  ? "Saved"
                  : row.state === "waiting"
                    ? "Waiting to save · kept in an encrypted pending file"
                    : "Not saved yet · still open here"}
              </div>
            </div>
          </li>
        ))}
        {notRestored.map((view) => (
          <li key={view.id} className="flex items-center gap-2" title={view.reason}>
            <FileX aria-hidden className="size-4 shrink-0 text-cream-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate">{view.title || "Untitled tab"}</div>
              <div className="text-xs text-cream-muted">Not restored · saved copy kept</div>
            </div>
          </li>
        ))}
      </ul>
      {saves.failed.length > 0 && accountId && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => void restoreNativeWorkspace(accountId).catch(() => undefined)}
        >
          Try saving again
        </Button>
      )}
    </section>
  );
}
