import { CheckCircle2, CircleAlert, Download, Expand, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PanelModal } from "./PanelModal";
import { VersionPicker } from "./VersionPicker";
import { useSetupStore } from "../../stores/useSetupStore";
import { useMinimumSpin } from "../../shared/hooks/useMinimumSpin";
import type { InstallCheck } from "../../models/setup";

function countReady(checks: InstallCheck[]) {
  return checks.filter((check) => check.exists).length;
}

function platformLabel(osName: string) {
  switch (osName) {
    case "macos":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return osName;
  }
}

function architectureLabel(osName: string, arch: string) {
  switch (arch) {
    case "aarch64":
    case "arm64":
      return osName === "macos" ? "Apple Silicon" : "ARM64";
    case "x86_64":
      return "x64";
    default:
      return arch;
  }
}

function sameVersion(left?: string | null, right?: string | null) {
  const normalize = (value?: string | null) => (value ?? "").trim().replace(/^v/i, "");
  return Boolean(normalize(left) && normalize(left) === normalize(right));
}

function CheckRow({ check }: { check: InstallCheck }) {
  return (
    <div className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 px-8 py-2.5">
      <CircleAlert aria-hidden="true" className="text-misty-warning" size={16} />
      <span className="min-w-0 truncate text-foreground" title={check.path}>
        {check.name}
      </span>
      <span className="min-w-0 max-w-[148px] truncate text-right text-[11px] font-medium text-muted-foreground">
        {check.exists ? "Ready" : check.required ? "Missing" : "Pending"}
      </span>
    </div>
  );
}

export function InstallerCard({
  className = "",
  embedded = false,
  variant = "full",
}: {
  className?: string;
  embedded?: boolean;
  variant?: "full" | "compact";
}) {
  const { user } = useAuth();
  const { busy, loadReleases, loadSystem, releases, releasesLoading, startInstall, status, systemError } = useSetupStore(
    useShallow((state) => ({
      busy: state.busy,
      loadReleases: state.loadReleases,
      loadSystem: state.loadSystem,
      releases: state.releases,
      releasesLoading: state.releasesLoading,
      startInstall: state.startInstall,
      status: state.status,
      systemError: state.systemError,
    })),
  );
  const [showMissingModal, setShowMissingModal] = useState(false);
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(busy);
  const [updatesSpinning, startUpdatesSpin] = useMinimumSpin(releasesLoading);
  const selectedVersion = useSetupStore((state) => state.selectedVersion);
  const latestVersion = releases[0]?.version ?? selectedVersion;
  const currentUser = status?.current_user ?? user ?? null;
  const selectedVersionInstalled = Boolean(status?.ready && sameVersion(status.installed_version, selectedVersion));
  const canInstall = !busy && Boolean(currentUser) && !selectedVersionInstalled;
  const osName = status?.os ?? (systemError ? "Unavailable" : "Resolving");
  const binaryType = status?.arch ?? (systemError ? "Unavailable" : "Resolving");
  const osLabel = platformLabel(osName);
  const archLabel = architectureLabel(osName, binaryType);
  const folderChecks = status?.folders ?? [];
  const fileChecks = status?.binaries ?? [];
  const foldersReady = countReady(folderChecks);
  const filesReady = countReady(fileChecks);
  const missingChecks = [...folderChecks, ...fileChecks].filter((check) => check.required && !check.exists);
  const allFound = folderChecks.length > 0 && fileChecks.length > 0 && missingChecks.length === 0;
  const installLabel = selectedVersionInstalled ? "Installed" : "Install";
  const compact = variant === "compact";
  const totalChecks = folderChecks.length + fileChecks.length;
  const readyChecks = foldersReady + filesReady;
  const installedVersionLabel = status?.installed_version ?? "Not installed";
  const readinessLabel = systemError
    ? "Unable to check install readiness"
    : totalChecks > 0
      ? `${readyChecks}/${totalChecks} required items ready`
      : "Resolving install readiness";

  return (
    <Card
      className={`flex ${compact ? "w-full" : "h-full w-full"} flex-col overflow-hidden ${
        embedded
          ? "!border-0 !bg-transparent !shadow-none"
          : "bg-card/95 shadow-2xl shadow-black/25"
      } ${className}`}
    >
      <div className={`flex min-w-0 flex-col gap-2 border-b border-border px-4 ${embedded ? "py-3" : "py-4"}`}>
        <VersionPicker />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            className="min-w-[116px] shrink-0 font-bold"
            disabled={!canInstall}
            onClick={() => void startInstall(currentUser)}
            type="button"
          >
            {selectedVersionInstalled ? (
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
            ) : (
              <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
            )}
            <span className="whitespace-nowrap">{installLabel}</span>
          </Button>
          <Button
            className="min-w-[164px] shrink-0 font-semibold"
            variant="outline"
            disabled={busy || releasesLoading}
            onClick={() => {
              startUpdatesSpin();
              void loadReleases();
            }}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 shrink-0 ${updatesSpinning ? "animate-spin" : ""}`} />
            <span className="whitespace-nowrap">Check for updates</span>
          </Button>
        </div>
      </div>

      <div className={`border-b border-border px-4 ${embedded ? "py-3" : "py-4"}`}>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div className="grid min-w-0 gap-1 text-left">
            <p className="text-base font-medium text-foreground">{osLabel} · {archLabel}</p>
            {compact ? (
              <>
                <p className="min-w-0 truncate text-sm text-muted-foreground">
                  Installed {installedVersionLabel} · Latest {latestVersion}
                </p>
                <p className={`min-w-0 truncate text-sm ${systemError ? "text-destructive" : "text-muted-foreground"}`}>
                  {readinessLabel}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {foldersReady}/{folderChecks.length || 0} folders · {filesReady}/{fileChecks.length || 0} files
              </p>
            )}
          </div>
          <Button
            aria-label="Refresh install checks"
            className="shrink-0"
            size="icon"
            variant="outline"
            disabled={busy}
            onClick={() => {
              startRefreshSpin();
              void loadSystem();
            }}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshSpinning ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div
        className={
          allFound
            ? `px-4 ${embedded ? "py-3" : "py-4"} ${compact ? "text-foreground" : "text-misty-success"}`
            : `${compact ? "" : "flex min-h-0 flex-1 flex-col"} py-2 text-xs`
        }
      >
        {allFound ? (
          <div className="flex min-w-0 items-center gap-3">
            <CheckCircle2 aria-hidden="true" className="shrink-0" size={16} />
            <span className="min-w-0 truncate">All required files and binaries are installed.</span>
          </div>
        ) : missingChecks.length > 0 ? (
          compact ? (
            <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-semibold text-foreground">
                  {missingChecks.length} required item{missingChecks.length === 1 ? "" : "s"} missing
                </p>
                <p className="m-0 mt-1 truncate text-xs text-muted-foreground">
                  Misty can restore these from the selected release.
                </p>
              </div>
              <Button
                className="shrink-0 text-[11px]"
                size="sm"
                variant="outline"
                onClick={() => setShowMissingModal(true)}
                type="button"
              >
                <Expand className="h-3.5 w-3.5" />
                View details
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-4 pb-2">
                <p className="text-[11px] font-semibold capitalize text-muted-foreground">
                  Missing Items
                </p>
                <Button
                  className="text-[11px]"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowMissingModal(true)}
                  type="button"
                >
                  <Expand className="h-3.5 w-3.5" />
                  View all
                </Button>
              </div>
              <div className="misty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-scroll">
                {missingChecks.map((check) => <CheckRow check={check} key={check.path} />)}
              </div>
            </>
          )
        ) : (
          <div className="px-4 py-2 text-muted-foreground">Resolving install readiness.</div>
        )}
      </div>

      {showMissingModal ? (
        <PanelModal
          onClose={() => setShowMissingModal(false)}
          subtitle={`${missingChecks.length} required item${missingChecks.length === 1 ? "" : "s"} still missing`}
          title="Missing install files"
        >
          <div className="py-2 text-xs">
            {missingChecks.map((check) => <CheckRow check={check} key={check.path} />)}
          </div>
        </PanelModal>
      ) : null}
    </Card>
  );
}
