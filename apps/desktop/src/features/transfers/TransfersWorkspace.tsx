import { RefreshCcw, Search, Trash2 } from "lucide-react";
import { prettyLabel } from "../../shared/format";
import { relativeTime, remoteSummary, transferProgress } from "./transferUtils";
import { useTransfersStore } from "./useTransfersStore";

export function TransfersWorkspace() {
  const {
    transfers,
    search,
    selectedIds,
    working,
    setSearch,
    load,
    toggleTransfer,
    deleteSelected,
    deleteAll,
  } = useTransfersStore();

  return (
    <section className="panel transfers-panel">
      <div className="panel-header transfers-header">
        <div>
          <h2>Transfers</h2>
          <p>{transfers ? `${transfers.totalCount} history rows · ${transfers.dbPath}` : "Loading transfer history"}</p>
        </div>
        <div className="transfer-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input value={search} placeholder="Search transfers" onChange={(event) => setSearch(event.target.value)} />
          </label>
          <button onClick={() => void load()} disabled={working}>
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button onClick={() => void deleteSelected()} disabled={working || selectedIds.size === 0}>
            <Trash2 size={16} />
            Delete Selected
          </button>
          <button className="danger" onClick={() => void deleteAll()} disabled={working || !transfers || transfers.totalCount === 0}>
            <Trash2 size={16} />
            Delete All
          </button>
        </div>
      </div>

      <div className="transfer-table-wrap">
        <table className="transfer-table">
          <thead>
            <tr>
              <th className="checkbox-cell"></th>
              <th>Transfer</th>
              <th>Operation</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Time</th>
              <th>Remote</th>
            </tr>
          </thead>
          <tbody>
            {transfers?.rows.map((row) => (
              <tr key={row.id}>
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={(event) => toggleTransfer(row.id, event.target.checked)}
                  />
                </td>
                <td>
                  <strong>{row.fileName || "Untitled transfer"}</strong>
                  <span>J-{row.jobId}</span>
                </td>
                <td>{prettyLabel(row.transferType)}</td>
                <td>
                  <span className={`status-badge ${row.status}`}>{prettyLabel(row.status)}</span>
                </td>
                <td>{transferProgress(row)}</td>
                <td>{relativeTime(row.completedAtMs || row.startedAtMs || row.queuedAtMs)}</td>
                <td>{remoteSummary(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {transfers && transfers.rows.length === 0 ? <div className="empty">No transfer history found.</div> : null}
      </div>
    </section>
  );
}
