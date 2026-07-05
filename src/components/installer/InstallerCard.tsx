import { CheckCircle2, CircleAlert, Download, Expand, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
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
      <CircleAlert aria-hidden="true" className="text-amber-300" size={16} />
      <span className="min-w-0 truncate text-[#f4f4f5]" title={check.path}>
        {check.name}
      </span>
      <span className="min-w-0 max-w-[148px] truncate text-right text-[11px] font-medium text-[#9aa3af]">
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
    <div
      className={`flex ${compact ? "w-full" : "h-full w-full"} flex-col overflow-hidden ${
        embedded
          ? ""
          : "rounded-lg border border-white/10 bg-[#0a0d10]/95 shadow-2xl shadow-black/25"
      } ${className}`}
    >
      <div className={`flex min-w-0 flex-col gap-2 border-b border-white/[0.08] px-4 ${embedded ? "py-3" : "py-4"}`}>
        <VersionPicker />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            className="inline-flex h-10 min-w-[116px] shrink-0 items-center justify-center gap-2 rounded-md bg-[#f4f4f5] px-3 text-sm font-bold text-[#07090b] shadow-lg shadow-white/5 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
          </button>
          <button
            className="inline-flex h-10 min-w-[164px] shrink-0 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm font-semibold text-[#d4d4d8] transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || releasesLoading}
            onClick={() => {
              startUpdatesSpin();
              void loadReleases();
            }}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 shrink-0 ${updatesSpinning ? "animate-spin" : ""}`} />
            <span className="whitespace-nowrap">Check for updates</span>
          </button>
        </div>
      </div>

      <div className={`border-b border-white/[0.08] px-4 ${embedded ? "py-3" : "py-4"}`}>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div className="grid min-w-0 gap-1 text-left">
            <p className="text-base font-medium text-[#f4f4f5]">{osLabel} · {archLabel}</p>
            {compact ? (
              <>
                <p className="min-w-0 truncate text-sm text-[#8f8f8f]">
                  Installed {installedVersionLabel} · Latest {latestVersion}
                </p>
                <p className={`min-w-0 truncate text-sm ${systemError ? "text-[#fca5a5]" : "text-[#8f8f8f]"}`}>
                  {readinessLabel}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-[#8f8f8f]">
                {foldersReady}/{folderChecks.length || 0} folders · {filesReady}/{fileChecks.length || 0} files
              </p>
            )}
          </div>
          <button
            aria-label="Refresh install checks"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-[#9aa3af] transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              startRefreshSpin();
              void loadSystem();
            }}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshSpinning ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div
        className={
          allFound
            ? `px-4 ${embedded ? "py-3" : "py-4"} ${compact ? "text-[#f4f4f5]" : "text-emerald-200"}`
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
                <p className="m-0 truncate text-sm font-semibold text-[#f4f4f5]">
                  {missingChecks.length} required item{missingChecks.length === 1 ? "" : "s"} missing
                </p>
                <p className="m-0 mt-1 truncate text-xs text-[#8f8f8f]">
                  Misty can restore these from the selected release.
                </p>
              </div>
              <button
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-[#d4d4d8] uppercase transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                onClick={() => setShowMissingModal(true)}
                type="button"
              >
                <Expand className="h-3.5 w-3.5" />
                View details
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-4 pb-2">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-[#8f8f8f] uppercase">
                  Missing Items
                </p>
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-[#d4d4d8] uppercase transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                  onClick={() => setShowMissingModal(true)}
                  type="button"
                >
                  <Expand className="h-3.5 w-3.5" />
                  View all
                </button>
              </div>
              <div className="misty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-scroll">
                {missingChecks.map((check) => <CheckRow check={check} key={check.path} />)}
              </div>
            </>
          )
        ) : (
          <div className="px-4 py-2 text-[#9aa3af]">Resolving install readiness.</div>
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
    </div>
  );
}
