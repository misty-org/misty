import type { RemoteListPanelProps } from "@/models/interfaces/pages/Providers/components/RemoteListPanel";
export type { RemoteListPanelProps } from "@/models/interfaces/pages/Providers/components/RemoteListPanel";
import { Button } from "@/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui";
import { remoteDisplayName } from "@/stores/backend";
import type { ProviderRemote } from "@/models/interfaces/services/misty-api";
import { iconAssets } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { PrimitiveIconButton } from "@/ui";
import { Panel, PanelHeader } from "@/pages/Providers/components/ProviderPanel";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { ProviderLogo } from "./ProviderLogo";
import { EmptyState, ErrorState } from "@/ui";
import { StatusBadge } from "@/ui";

const remotePanelClass =
  "grid min-h-0 grid-rows-[auto_minmax(0,1fr)] !rounded-none !border-0 !bg-transparent !shadow-none [border-radius:0]";

const remoteListActionsClass = "flex items-center gap-2";

const remoteListClass = "min-h-0 overflow-auto p-2";

const remoteRowClass =
  "relative grid w-full grid-cols-[minmax(0,1fr)_30px] items-center border-b border-border bg-transparent text-foreground hover:bg-muted/70";

const remoteRowSelectedClass = "bg-muted shadow-[inset_3px_0_0_var(--primary)]";

const remoteRowSelectClass =
  "grid h-auto min-w-0 grid-cols-[28px_minmax(120px,1fr)_82px_126px] items-center justify-start gap-2.5 rounded-none px-2 py-[11px] pl-2.5 text-left text-inherit hover:bg-transparent";

const remoteProviderIconClass = "grid h-[26px] w-[26px] place-items-center text-primary";

const remoteProviderIconWarningClass = "text-amber-500";

export function RemoteListPanel(props: RemoteListPanelProps) {
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(props.loading);
  return (
    <Panel as="aside" className={remotePanelClass}>
      <PanelHeader
        title="Remotes"
        subtitle={`${props.remotes.length} remotes`}
        actions={
          <div className={remoteListActionsClass}>
            <PrimitiveIconButton
              className="text-muted-foreground/70 hover:text-foreground"
              onClick={() => {
                startRefreshSpin();
                props.onRefresh();
              }}
              disabled={props.loading || props.working}
              label="Refresh remotes"
              size="sm"
            >
              <AssetIcon
                className={refreshSpinning ? "animate-spin" : undefined}
                src={iconAssets.sync16}
                size={16}
              />
            </PrimitiveIconButton>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={props.onAdd}
              disabled={props.working}
            >
              <AssetIcon src={iconAssets.plus16} size={16} /> Add Remote
            </Button>
          </div>
        }
      />

      <div className={remoteListClass}>
        {props.remotes.map((remote) => (
          <RemoteRow
            key={remote.name}
            remote={remote}
            selected={props.selectedRemoteName === remote.name}
            onSelect={() => props.onSelectRemote(remote.name)}
            onRepair={() => props.onRepair(remote)}
            onDisconnect={() => props.onDisconnect(remote.name)}
          />
        ))}
        {!props.loading && props.remotes.length === 0 ? (
          props.serviceError ? (
            <ErrorState
              compact
              title="Remote service unavailable"
              description={props.serviceError}
            />
          ) : (
            <EmptyState
              compact
              title="No remotes found"
              description="Add a provider remote to make cloud storage available in Files."
            />
          )
        ) : null}
      </div>
    </Panel>
  );
}

function RemoteRow(props: {
  remote: ProviderRemote;
  selected: boolean;
  onSelect: () => void;
  onRepair: () => void;
  onDisconnect: () => void;
}) {
  const { remote, selected, onSelect } = props;
  const externalConfig = remote.configSource === "user";

  return (
    <div className={`${remoteRowClass} ${selected ? remoteRowSelectedClass : ""}`}>
      <Button
        variant="ghost"
        className={remoteRowSelectClass}
        type="button"
        title={remote.error ?? undefined}
        onClick={externalConfig ? props.onRepair : onSelect}
      >
        <span
          className={`${remoteProviderIconClass} ${remote.needsReconnect ? remoteProviderIconWarningClass : ""}`}
        >
          <ProviderLogo type={remote.type} size={19} />
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap font-[580]">
          {remoteDisplayName(remote)}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">
          {remote.type}
          {externalConfig ? " · user config" : ""}
        </span>
        <StatusBadge
          className="max-w-full truncate"
          status={remote.needsReconnect ? "warning" : "success"}
          dot
        >
          {remote.statusLabel}
        </StatusBadge>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label={`Actions for ${remote.name}`}
          >
            <AssetIcon src={iconAssets.kebabHorizontal24} size={17} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {externalConfig ? (
            <>
              <DropdownMenuItem onClick={props.onRepair}>
                <AssetIcon src={iconAssets.plus16} size={15} /> Import
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={props.onDisconnect}
              >
                <AssetIcon src={iconAssets.trash24} size={15} /> Delete
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={props.onRepair}>
                <AssetIcon src={iconAssets.gear24} size={15} /> Configure
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={props.onDisconnect}
              >
                <AssetIcon src={iconAssets.trash24} size={15} /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
