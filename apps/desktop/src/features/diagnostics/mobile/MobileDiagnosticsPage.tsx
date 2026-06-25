import { useProvidersStore } from "../../providers/useProvidersStore";
import { useAppStore } from "../../../app/useAppStore";
import type { AppEnvironmentSnapshot } from "../../../api/types";
import type { ReactNode } from "react";

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
      <section className="mobile-page mobile-diagnostics-page">
        <div className="mobile-empty-state">
          <h3>Loading diagnostics</h3>
          <p>Runtime information will appear here once Misty is ready.</p>
        </div>
      </section>
    );
  }

  const pathRows = mobileDiagnosticPathRows(environment);
  const envRows = Object.entries(environment.derivedEnv);

  return (
    <section className="mobile-page mobile-diagnostics-page">
      <div className="mobile-section-header">
        <div>
          <span>Misty</span>
          <h2>Diagnostics</h2>
        </div>
      </div>

      <MobileDiagnosticsPanel title="Runtime" detail={providerStatus}>
        <MobileDiagnosticRow label="Proxy URL" value={environment.proxyUrl ?? "--"} />
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
        {envRows.length === 0 ? <p className="mobile-diagnostics-empty">No derived environment values.</p> : null}
        {envRows.map(([label, value]) => (
          <MobileDiagnosticRow key={label} label={label} value={value} />
        ))}
      </MobileDiagnosticsPanel>
    </section>
  );
}

function MobileDiagnosticsPanel(props: { title: string; detail: string; children: ReactNode }) {
  return (
    <section className="mobile-panel mobile-diagnostics-panel">
      <header>
        <div>
          <span>{props.title}</span>
          <h3>{props.title}</h3>
          <p>{props.detail}</p>
        </div>
      </header>
      <div className="mobile-diagnostics-list">{props.children}</div>
    </section>
  );
}

function MobileDiagnosticRow(props: { label: string; value: string }) {
  return (
    <div className="mobile-diagnostics-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
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
