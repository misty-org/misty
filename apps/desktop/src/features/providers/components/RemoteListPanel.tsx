import { useState } from "react";
import { remoteDisplayName } from "../../../api/misty";
import type { ProviderRemote } from "../../../api/types";
import { iconAssets, providerIconForType } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { IconButton } from "../../../shared/components/IconButton";
import { Panel, PanelHeader } from "../../../shared/components/Panel";

interface RemoteListPanelProps {
  remotes: ProviderRemote[];
  selectedRemoteName: string | null;
  loading: boolean;
  working: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onSelectRemote: (name: string) => void;
  onReconnect: (remote: ProviderRemote) => void;
  onRepair: (remote: ProviderRemote) => void;
  onDisconnect: (name: string) => void;
}

export function RemoteListPanel(props: RemoteListPanelProps) {
  return (
    <Panel as="aside" className="remotes-panel">
      <PanelHeader
        title="Providers"
        subtitle={`${props.remotes.length} remotes`}
        actions={<div className="remote-list-actions">
          <IconButton onClick={props.onRefresh} disabled={props.loading || props.working} title="Refresh remotes">
            <AssetIcon src={iconAssets.sync16} size={16} />
          </IconButton>
          <button className="primary compact" type="button" onClick={props.onAdd} disabled={props.working}>
            <AssetIcon src={iconAssets.plus16} size={16} /> Add Remote
          </button>
        </div>}
      />

      <div className="remote-list">
        {props.remotes.map((remote) => (
          <RemoteRow
            key={remote.name}
            remote={remote}
            selected={props.selectedRemoteName === remote.name}
            onSelect={() => props.onSelectRemote(remote.name)}
            onReconnect={() => props.onReconnect(remote)}
            onRepair={() => props.onRepair(remote)}
            onDisconnect={() => props.onDisconnect(remote.name)}
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
  onReconnect: () => void;
  onRepair: () => void;
  onDisconnect: () => void;
}) {
  const { remote, selected, onSelect } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const providerIcon = providerIconForType(remote.type);
  return (
    <div className={`remote-row ${selected ? "selected" : ""}`}>
      <button className="remote-row-select" type="button" onClick={onSelect}>
        <span className={remote.needsReconnect ? "remote-provider-icon warning" : "remote-provider-icon"}>
          <AssetIcon src={providerIcon.src} color={providerIcon.color} size={17} />
        </span>
        <span className="remote-name">{remoteDisplayName(remote)}</span>
        <span className="remote-type">{remote.type}</span>
        <span className={remote.needsReconnect ? "remote-status warning" : "remote-status"}>
          <AssetIcon src={remote.needsReconnect ? iconAssets.xCircleFill16 : iconAssets.verified24} size={14} />
          {remote.statusLabel}
        </span>
      </button>
      <div className="remote-row-menu-wrap">
        <button
          className="remote-row-menu-trigger"
          type="button"
          aria-label={`Actions for ${remote.name}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <AssetIcon src={iconAssets.kebabHorizontal24} size={17} />
        </button>
        {menuOpen ? (
          <div className="remote-row-menu" role="menu">
            {remote.needsReconnect ? <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onReconnect(); }}><AssetIcon src={iconAssets.sync16} size={15} /> Reconnect</button> : null}
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onRepair(); }}><AssetIcon src={iconAssets.gear24} size={15} /> Configure</button>
            <button className="danger" type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onDisconnect(); }}><AssetIcon src={iconAssets.trash24} size={15} /> Disconnect</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
