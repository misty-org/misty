import { RefreshCcw } from "lucide-react";
import { remoteDisplayName } from "../../../api/misty";
import type { ProviderRemote } from "../../../api/types";
import { IconButton } from "../../../shared/components/IconButton";
import { Panel, PanelHeader } from "../../../shared/components/Panel";

interface RemoteListPanelProps {
  remotes: ProviderRemote[];
  selectedRemoteName: string | null;
  loading: boolean;
  working: boolean;
  onRefresh: () => void;
  onSelectRemote: (name: string) => void;
}

export function RemoteListPanel(props: RemoteListPanelProps) {
  return (
    <Panel as="aside" className="remotes-panel">
      <PanelHeader
        title="Providers"
        subtitle={`${props.remotes.length} remotes`}
        actions={
          <IconButton onClick={props.onRefresh} disabled={props.loading || props.working}>
            <RefreshCcw size={16} />
          </IconButton>
        }
      />

      <div className="remote-list">
        {props.remotes.map((remote) => (
          <RemoteRow
            key={remote.name}
            remote={remote}
            selected={props.selectedRemoteName === remote.name}
            onSelect={() => props.onSelectRemote(remote.name)}
          />
        ))}
        {!props.loading && props.remotes.length === 0 ? <div className="empty">No remotes found.</div> : null}
      </div>
    </Panel>
  );
}

function RemoteRow(props: {
  remote: ProviderRemote;
  selected: boolean;
  onSelect: () => void;
}) {
  const { remote, selected, onSelect } = props;
  return (
    <button className={`remote-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      <span className="remote-name">{remoteDisplayName(remote)}</span>
      <span className="remote-type">{remote.type}</span>
      <span className={remote.needsReconnect ? "remote-status warning" : "remote-status"}>{remote.statusLabel}</span>
    </button>
  );
}
