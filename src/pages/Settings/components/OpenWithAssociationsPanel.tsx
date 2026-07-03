import { RefreshCcw, Trash2 } from "lucide-react";
import type { OpenWithAssociation } from "../../../api/types";
import { Panel, PanelHeader } from "../../../shared/components/Panel";

interface OpenWithAssociationsPanelProps {
  associations: OpenWithAssociation[];
  working: boolean;
  onRefresh: () => void;
  onRemove: (key: string) => void;
}

export function OpenWithAssociationsPanel(props: OpenWithAssociationsPanelProps) {
  return (
    <Panel className="settings-panel open-with-panel">
      <PanelHeader
        title="Open With Associations"
        subtitle="Review remembered apps used by File Explorer."
        actions={
          <button type="button" onClick={props.onRefresh} disabled={props.working}>
            <RefreshCcw size={16} />
            Refresh
          </button>
        }
      />
      <div className="open-with-table-wrap">
        <table className="open-with-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Application</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.associations.map((association) => (
              <tr key={association.key}>
                <td>
                  <strong>{association.key}</strong>
                </td>
                <td title={association.applicationPath}>{association.applicationPath}</td>
                <td>
                  <button
                    type="button"
                    className="danger subtle"
                    onClick={() => props.onRemove(association.key)}
                    disabled={props.working}
                  >
                    <Trash2 size={15} />
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {props.associations.length === 0 ? (
          <div className="m-[18px] text-[var(--misty-text-muted)]">No Open With associations saved.</div>
        ) : null}
      </div>
    </Panel>
  );
}
