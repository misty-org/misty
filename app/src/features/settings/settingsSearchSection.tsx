import { formatDate } from "@/features/file-explorer";
import { useSearchStore } from "@/features/file-search";
import type { SearchStatus } from "@/services/misty/model/misty-api";
import { userFacingErrorText } from "@/shared/lib/format";
import { Badge, Button, Spinner } from "@/shared/ui";
import { Cloud, FolderOpen, HardDrive, Search } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "./components/DesktopSettingsUI";

import {
  discoveryIntervalLabels,
  discoveryIntervalOptions,
  settingsControlButtonClass,
  settingsControlButtonCompactClass,
  settingsReferenceHeaderClass,
  settingsReferenceListClass,
  settingsReferenceRowClass,
  settingsReferenceSpanClass,
} from "./settingsConstants";
import { booleanSetting, numberSetting, SelectControl, SwitchControl } from "./settingsControls";
import type { SettingsContentProps } from "./settingsTypes";
export function SearchSettings(props: SettingsContentProps) {
  const { status, error, initialize, refreshStatus, startScan, cancelScan } = useSearchStore(
    useShallow((state) => ({
      status: state.status,
      error: state.error,
      initialize: state.initialize,
      refreshStatus: state.refreshStatus,
      startScan: state.startScan,
      cancelScan: state.cancelScan,
    })),
  );
  useEffect(() => {
    void initialize();
    const timer = window.setInterval(
      () => {
        void refreshStatus();
      },
      status?.scanInProgress ? 700 : 5000,
    );
    return () => window.clearInterval(timer);
  }, [initialize, refreshStatus, status?.scanInProgress]);

  const scanActive = Boolean(status?.scanInProgress);
  const indexedItems = status?.indexedItemCount ?? 0;
  const indexedLocalRoots = status?.indexedLocalRoots ?? [];
  const indexedRemoteNames = status?.indexedRemoteNames ?? [];
  const scanProgress = status?.scanIndexedItemCount ?? 0;
  const lastIndexed = status?.lastScanTimeMs ? formatDate(status.lastScanTimeMs) : "Never";
  const automaticFileDiscovery = booleanSetting(
    props.document,
    "search",
    "automatic_file_discovery_enabled",
    true,
  );
  return (
    <>
      <div className="mb-4 grid gap-3">
        <SearchHealthCard
          icon={<Search size={19} />}
          title="File search"
          value={scanActive ? "Updating quietly" : indexedItems ? "Ready" : "Getting ready"}
          detail={
            indexedItems
              ? `${indexedItems.toLocaleString()} files and folders available to search`
              : "Misty will discover filenames without using AI"
          }
          active={scanActive}
        />
      </div>

      <SettingsSectionBlock title="Automatic upkeep">
        <SettingsRow
          label="Keep file search ready"
          description="Misty checks for added, renamed, moved, or removed files while the app is open. Existing results stay searchable during updates."
        >
          <SwitchControl
            checked={automaticFileDiscovery}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("search", "automatic_file_discovery_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Check for changes every"
          description="How often Misty looks for file changes while it is open."
          last
        >
          <SelectControl
            value={Math.max(
              0,
              discoveryIntervalOptions.indexOf(
                numberSetting(props.document, "search", "discovery_interval_minutes", 15),
              ),
            )}
            options={discoveryIntervalLabels}
            disabled={props.working || !automaticFileDiscovery}
            onChange={(value) =>
              props.onSettingChange(
                "search",
                "discovery_interval_minutes",
                discoveryIntervalOptions[value] ?? 15,
              )
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Files available to search">
        <div className="grid gap-4 px-5 py-5">
          <div className="flex items-start justify-between gap-5">
            <div className="flex min-w-0 gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-charcoal-card text-cream-muted">
                {scanActive ? (
                  <Spinner label="Checking files" size="lg" />
                ) : (
                  <HardDrive size={18} />
                )}
              </div>
              <div className="grid min-w-0 gap-1">
                <strong className="text-sm font-medium text-cream">
                  {scanActive
                    ? "Checking for file changes"
                    : indexedItems
                      ? "Search is kept up to date"
                      : "Ready for the first check"}
                </strong>
                <span className="text-sm leading-relaxed text-cream-muted">
                  {scanActive
                    ? `${scanProgress.toLocaleString()} items checked${status?.currentPath ? ` · ${shortPath(status.currentPath)}` : ""}`
                    : status?.lastScanTimeMs
                      ? `Last checked ${lastIndexed}. Misty found ${formatSearchChanges(status)}.`
                      : "Run the first check to make filenames and folders available from Spotlight."}
                </span>
                {error || status?.lastScanError ? (
                  <span className="text-sm text-cream-bright">
                    {userFacingErrorText(error || status?.lastScanError)}
                  </span>
                ) : null}
              </div>
            </div>
            {scanActive ? (
              <Button
                variant="outline"
                size="sm"
                className={settingsControlButtonCompactClass}
                type="button"
                onClick={() => void cancelScan()}
              >
                Stop
              </Button>
            ) : (
              <Button
                variant="outline"
                className={settingsControlButtonClass}
                type="button"
                onClick={() => void startScan("")}
              >
                Check now
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-charcoal-border/60 pt-4 max-[720px]:grid-cols-1">
            <SearchStatCard label="Searchable" value={indexedItems.toLocaleString()} compact />
            <SearchStatCard
              label="On this device"
              value={(status?.indexedLocalItemCount ?? 0).toLocaleString()}
              compact
            />
            <SearchStatCard
              label="Cloud files"
              value={(status?.indexedRemoteItemCount ?? 0).toLocaleString()}
              compact
            />
          </div>
          <p className="m-0 text-xs leading-relaxed text-cream-muted">
            Covered: {friendlyCoverage(indexedLocalRoots, indexedRemoteNames)}. Common build and
            cache folders are skipped automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            {indexedLocalRoots.map((root, index) => (
              <Badge variant="secondary" className="gap-1.5" key={root} title={root}>
                <FolderOpen size={12} />
                {coverageRootLabel(root, index)}
              </Badge>
            ))}
            {indexedRemoteNames.map((name) => (
              <Badge variant="secondary" className="gap-1.5" key={name}>
                <Cloud size={12} />
                {name}
              </Badge>
            ))}
          </div>
        </div>
      </SettingsSectionBlock>

      {status?.scanErrors.length ? (
        <SettingsSectionBlock title="Files Misty could not check">
          <div className={settingsReferenceListClass}>
            <div className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}>
              <span>Source</span>
              <span>Error</span>
            </div>
            {status.scanErrors.map((scanError) => (
              <div
                className={settingsReferenceRowClass}
                key={`${scanError.source}:${scanError.message}`}
              >
                <span className={settingsReferenceSpanClass}>{scanError.source}</span>
                <span className="min-w-0 [overflow-wrap:anywhere] text-cream-bright">
                  {userFacingErrorText(scanError.message)}
                </span>
              </div>
            ))}
          </div>
        </SettingsSectionBlock>
      ) : null}
    </>
  );
}

export function SearchHealthCard(props: {
  icon: ReactNode;
  title: string;
  value: string;
  detail: string;
  active?: boolean;
  attention?: boolean;
}) {
  return (
    <div className="grid min-h-28 grid-cols-[40px_minmax(0,1fr)] gap-3 rounded-xl bg-charcoal-card p-4 shadow-xs inset-ring-1 inset-ring-cream/10">
      <div
        className={`grid size-10 place-items-center rounded-lg ${props.attention ? "bg-charcoal-active text-cream-bright" : "bg-charcoal-card text-cream-muted"}`}
      >
        {props.active ? <Spinner label="Updating file search" size="lg" /> : props.icon}
      </div>
      <div className="grid content-center gap-1">
        <span className="text-xs text-cream-muted">{props.title}</span>
        <strong className="text-lg font-semibold text-cream">{props.value}</strong>
        <span className="text-xs leading-relaxed text-cream-muted">{props.detail}</span>
      </div>
    </div>
  );
}

export function SearchStatCard(props: { label: string; value: string; compact?: boolean }) {
  return (
    <div
      className={`${props.compact ? "min-h-[54px]" : "min-h-[76px]"} grid content-center gap-1 rounded-md bg-charcoal-card px-3`}
    >
      <strong
        className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${props.compact ? "text-base" : "text-xl"} font-semibold tabular-nums text-cream`}
      >
        {props.value}
      </strong>
      <span className="text-xs text-cream-muted">{props.label}</span>
    </div>
  );
}

export function formatSearchChanges(status: SearchStatus): string {
  const changes = [
    [status.lastScanAddedItemCount ?? 0, "new"],
    [status.lastScanUpdatedItemCount ?? 0, "updated"],
    [status.lastScanRemovedItemCount ?? 0, "removed"],
  ] as const;
  const visible = changes.filter(([count]) => count > 0);
  return visible.length
    ? visible.map(([count, label]) => `${count.toLocaleString()} ${label}`).join(", ")
    : "no changes";
}

export function friendlyCoverage(localRoots: string[], remoteNames: string[]): string {
  const pieces: string[] = [];
  if (localRoots.length === 1) pieces.push("your home folder");
  else if (localRoots.length > 1) pieces.push(`${localRoots.length} folders on this device`);
  if (remoteNames.length === 1) pieces.push(`the ${remoteNames[0]} cloud connection`);
  else if (remoteNames.length > 1) pieces.push(`${remoteNames.length} cloud connections`);
  return pieces.length ? pieces.join(" and ") : "no folders yet";
}

export function coverageRootLabel(path: string, index: number): string {
  if (index === 0) return "Home folder";
  return path.split(/[\\/]/).filter(Boolean).pop() || "Local folder";
}

export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}
