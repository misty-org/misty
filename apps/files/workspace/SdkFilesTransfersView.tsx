import { useState } from "react";
import type { MistyAppSDK } from "@misty/sdk";
import { Button, Input } from "@/shared/ui";
import type { SdkFilesTransferHistory } from "./sdkFilesTransferHistory";
import { formatBytes } from "./format";

export function SdkFilesTransfersView({ history, misty }: { history: SdkFilesTransferHistory; misty: MistyAppSDK }) {
  const state = history.store();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const run = (operation: () => Promise<unknown>) => {
    setError("");
    void operation().catch(error => setError(String(error)));
  };
  const rows = state.rows.filter(row => `${row.name} ${row.message}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="flex h-full min-h-0 flex-col bg-charcoal-bg">
    <div className="flex h-12 shrink-0 items-center gap-4 border-b border-charcoal-border px-3">
      <span className="text-sm font-medium">Transfers</span>
      <Input aria-label="Search transfers" placeholder="Search transfers…" value={query} onChange={event => setQuery(event.target.value)} className="max-w-sm" />
    </div>
    {(error || state.error) && <p role="alert" className="px-3 py-2 text-sm">{error || state.error}</p>}
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-charcoal-bg text-xs text-cream-muted"><tr>
          <th className="px-3 py-2 font-normal">Name</th><th className="px-3 py-2 font-normal">Progress</th><th className="px-3 py-2 font-normal">Status</th><th className="px-3 py-2 font-normal">Actions</th>
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-t border-charcoal-border">
          <td className="max-w-80 truncate px-3 py-2" title={row.name}>{row.name}</td>
          <td className="whitespace-nowrap px-3 py-2 text-cream-muted">{formatBytes(row.bytes)}</td>
          <td className="px-3 py-2 text-cream-muted" role="status">{row.message}</td>
          <td className="whitespace-nowrap px-3 py-2">
            {row.status === "running" || row.status === "queued"
              ? <Button variant="ghost" size="sm" onClick={() => history.cancel(row.id)}>Cancel</Button>
              : <>
                {(row.status === "failed" || row.status === "cancelled") && history.canRetry(row.id) &&
                  <Button variant="ghost" size="sm" onClick={() => run(() => history.retry(row.id))}>Retry</Button>}
                <Button variant="ghost" size="sm" aria-label={`Remove ${row.name} from transfer history`} onClick={() => run(() => history.remove(row.id, misty))}>Remove</Button>
              </>}
          </td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="p-4 text-sm text-cream-muted">{query ? "No matching transfers." : "No transfers yet."}</p>}
    </div>
    <div className="h-8 shrink-0 border-t border-charcoal-border px-3 py-1.5 text-xs text-cream-muted">{rows.length} transfers</div>
  </section>;
}
