import { useProvidersStore } from "../../providers/useProvidersStore";
import { useAppStore } from "../../../app/useAppStore";
import type { AppEnvironmentSnapshot } from "../../../api/types";
import type { ReactNode } from "react";
import { mobilePageClass } from "../../../app/mobileStyles";

export function MobileDiagnosticsPage() {
  const environment = useAppStore((state) => state.app?.environment ?? null);
  const providerStatus = useProvidersStore((state) => {
    const providers = state.providers;
    if (!providers) return "Starting";
    return providers.health.ready
      ? `Ready${providers.health.version ? ` · ${providers.health.version}` : ""}`
      : providers.health.error || providers.error || "Provider service unavailable";
  });

  if (!environment) {
    return (
      <section className={`${mobilePageClass} grid content-start gap-3`}>
        <div className="grid min-h-[220px] place-items-center gap-1.5 text-center text-[#a3adba]">
          <h3 className="m-0 text-lg font-bold text-[var(--misty-text)]">Loading diagnostics</h3>
          <p className="m-0 max-w-60 text-sm text-[var(--misty-text-muted)]">
            Runtime information will appear here once Misty is ready.
          </p>
        </div>
      </section>
    );
  }

  const pathRows = mobileDiagnosticPathRows(environment);
  const envRows = Object.entries(environment.derivedEnv);

  return (
    <section className={`${mobilePageClass} grid content-start gap-3`}>
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <div>
          <span className="text-[11px] font-[760] uppercase tracking-normal text-[var(--misty-text-subtle)]">Misty</span>
          <h2 className="m-0 text-[22px] font-black leading-tight text-[var(--misty-text)]">Diagnostics</h2>
        </div>
      </div>

      <MobileDiagnosticsPanel title="Runtime" detail={providerStatus}>
        <MobileDiagnosticRow label="Remote runtime" value="Embedded" />
        <MobileDiagnosticRow label="Server URL" value={environment.serverUrl ?? "--"} />
        <MobileDiagnosticRow label="gRPC address" value={environment.grpcAddress} />
        <MobileDiagnosticRow label="Mount path" value={environment.mountPath} />
        <MobileDiagnosticRow label="Config exists" value={environment.configExists ? "Yes" : "No"} />
      </MobileDiagnosticsPanel>

      <MobileDiagnosticsPanel title="Paths" detail="Shared Rust source of truth for migrated services.">
        {pathRows.map(([label, value]) => (
          <MobileDiagnosticRow key={label} label={label} value={value} />
        ))}
      </MobileDiagnosticsPanel>

      <MobileDiagnosticsPanel title="Derived Env" detail="Safe values derived from misty.json and process overrides.">
        {envRows.length === 0 ? (
          <p className="m-0 text-xs leading-[1.4] text-[#a3adba]">No derived environment values.</p>
        ) : null}
        {envRows.map(([label, value]) => (
          <MobileDiagnosticRow key={label} label={label} value={value} />
        ))}
      </MobileDiagnosticsPanel>
    </section>
  );
}

function MobileDiagnosticsPanel(props: { title: string; detail: string; children: ReactNode }) {
  return (
    <section className="mb-3 min-w-0">
      <header className="mb-2 flex items-start justify-start">
        <div className="grid min-w-0 gap-1">
          <span className="text-[11px] font-extrabold uppercase tracking-normal text-[#8792a0]">{props.title}</span>
          <h3 className="m-0 text-[22px] font-black leading-tight text-[var(--misty-text)]">{props.title}</h3>
          <p className="m-0 text-xs leading-[1.4] text-[#a3adba]">{props.detail}</p>
        </div>
      </header>
      <div className="grid gap-2">{props.children}</div>
    </section>
  );
}

function MobileDiagnosticRow(props: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 border-0 bg-transparent px-0 py-2">
      <span className="text-[11px] font-extrabold uppercase tracking-normal text-[#8792a0]">{props.label}</span>
      <strong className="min-w-0 [overflow-wrap:anywhere] text-[13px] font-[680] leading-[1.35] text-[#eef3fb]">
        {props.value}
      </strong>
    </div>
  );
}

function mobileDiagnosticPathRows(environment: AppEnvironmentSnapshot): Array<[string, string]> {
  return [
    ["Misty home", environment.mistyDir],
    ["Config", environment.mistyConfigPath],
    ["Settings", environment.settingsPath],
    ["Workspaces", environment.workspacesPath],
    ["Commands", environment.commandsPath],
    ["Database", environment.dbDir],
    ["Cache", environment.cacheDir],
    ["Temporary files", environment.tmpDir],
    ["Assets", environment.assetsDir],
    ["Public plugins", environment.pluginsPublicDir],
    ["Private plugins", environment.pluginsPrivateDir],
  ];
}
