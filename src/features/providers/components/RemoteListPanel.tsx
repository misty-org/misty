import { useState } from "react";
import { remoteDisplayName } from "../../../api/misty";
import type { ProviderRemote } from "../../../api/types";
import { iconAssets, providerIconForType } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { IconButton } from "../../../shared/components/IconButton";
import { Panel, PanelHeader } from "../../../shared/components/Panel";

const remotePanelClass =
  "grid min-h-0 grid-rows-[auto_minmax(0,1fr)]";

const remoteListActionsClass =
  "flex items-center gap-2";

const remoteListClass =
  "min-h-0 overflow-auto p-2";

const addRemoteButtonClass =
  "primary compact inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--misty-primary)] bg-[var(--misty-primary)] px-2.5 py-1.5 text-[13px] text-[var(--misty-primary-contrast)] disabled:opacity-55";

const remoteRowClass =
  "relative grid w-full grid-cols-[minmax(0,1fr)_30px] items-center border-b border-[var(--misty-border-soft)] bg-transparent text-[var(--misty-text)] hover:bg-[color-mix(in_srgb,var(--misty-surface-3)_76%,transparent)]";

const remoteRowSelectedClass =
  "bg-[color-mix(in_srgb,var(--misty-surface-3)_76%,transparent)] shadow-[inset_3px_0_0_var(--misty-accent)]";

const remoteRowSelectClass =
  "grid min-w-0 grid-cols-[28px_minmax(120px,1fr)_82px_126px] items-center gap-2.5 border-0 bg-transparent px-2 py-[11px] pl-2.5 text-left text-inherit";

const remoteProviderIconClass =
  "grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[color-mix(in_srgb,var(--misty-accent)_30%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-accent)_10%,var(--misty-surface))] text-[var(--misty-accent)]";

const remoteProviderIconWarningClass =
  "border-[color-mix(in_srgb,var(--misty-warning)_40%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-warning)_12%,var(--misty-surface))] text-[var(--misty-warning)]";

const remoteMenuTriggerClass =
  "grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-3)] hover:text-[var(--misty-text)]";

const remoteMenuClass =
  "absolute right-0 top-8 z-30 grid w-40 gap-[3px] rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface-2)] p-[5px] shadow-[0_12px_32px_var(--misty-shadow)]";

const remoteMenuButtonClass =
  "flex items-center gap-2 rounded-md border-0 bg-transparent px-[9px] py-2 text-left text-[var(--misty-text)] hover:bg-[var(--misty-surface-3)]";

interface RemoteListPanelProps {
  remotes: ProviderRemote[];
  selectedRemoteName: string | null;
  loading: boolean;
  serviceError: string | null;
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
    <Panel as="aside" className={remotePanelClass}>
      <PanelHeader
        title="Remotes"
        subtitle={`${props.remotes.length} remotes`}
        actions={<div className={remoteListActionsClass}>
          <IconButton onClick={props.onRefresh} disabled={props.loading || props.working} title="Refresh remotes">
            <AssetIcon src={iconAssets.sync16} size={16} />
          </IconButton>
          <button className={addRemoteButtonClass} type="button" onClick={props.onAdd} disabled={props.working}>
            <AssetIcon src={iconAssets.plus16} size={16} /> Add Remote
          </button>
        </div>}
      />

      <div className={remoteListClass}>
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
        {!props.loading && props.remotes.length === 0 ? (
          <div className="m-[18px] grid gap-2 text-[var(--misty-text-muted)]">
            <strong className="text-[var(--misty-text)]">
              {props.serviceError ? "Remote service unavailable" : "No remotes found."}
            </strong>
            {props.serviceError ? (
              <span className="text-sm leading-normal">
                {props.serviceError}
              </span>
            ) : null}
          </div>
        ) : null}
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
    <div className={`${remoteRowClass} ${selected ? remoteRowSelectedClass : ""}`}>
      <button className={remoteRowSelectClass} type="button" onClick={onSelect}>
        <span className={`${remoteProviderIconClass} ${remote.needsReconnect ? remoteProviderIconWarningClass : ""}`}>
          <AssetIcon src={providerIcon.src} color={providerIcon.color} size={17} />
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap font-[580]">{remoteDisplayName(remote)}</span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[var(--misty-text-muted)]">{remote.type}</span>
        <span className={`inline-flex items-center gap-[5px] overflow-hidden text-ellipsis whitespace-nowrap ${remote.needsReconnect ? "text-[var(--misty-warning)]" : "text-[var(--misty-success)]"}`}>
          <AssetIcon src={remote.needsReconnect ? iconAssets.xCircleFill16 : iconAssets.verified24} size={14} />
          {remote.statusLabel}
        </span>
      </button>
      <div className="relative">
        <button
          className={remoteMenuTriggerClass}
          type="button"
          aria-label={`Actions for ${remote.name}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <AssetIcon src={iconAssets.kebabHorizontal24} size={17} />
        </button>
        {menuOpen ? (
          <div className={remoteMenuClass} role="menu">
            {remote.needsReconnect ? <button className={remoteMenuButtonClass} type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onReconnect(); }}><AssetIcon src={iconAssets.sync16} size={15} /> Reconnect</button> : null}
            <button className={remoteMenuButtonClass} type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onRepair(); }}><AssetIcon src={iconAssets.gear24} size={15} /> Configure</button>
            <button className={`${remoteMenuButtonClass} text-[var(--misty-danger)]`} type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onDisconnect(); }}><AssetIcon src={iconAssets.trash24} size={15} /> Disconnect</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
