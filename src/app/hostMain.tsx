import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import { initializeHostLibraryRuntime } from "@/features/library/library";
import { analytics } from "@/telemetry/client";
import { initializeAnalyticsLifecycle } from "@/telemetry/lifecycle";
import { TelemetryErrorBoundary } from "@/telemetry/TelemetryErrorBoundary";
import { isNativeMobileBuild, isWebBuild } from "@/shared/platform/buildTarget";
import {
  configureMistyBrowserLinkOpener,
  installExternalLinkRouting,
} from "@/shared/platform/openExternalLink";
import { hasTauriInternals } from "@/shared/platform/tauri";
import ReactDOM from "react-dom/client";

if (!isNativeMobileBuild && !isWebBuild) {
  configureMistyBrowserLinkOpener(async (url) => {
    if (!hasTauriInternals())
      throw new Error("Misty Browser is unavailable outside the desktop app.");
    const { useWorkspaceStore } = await import("@/features/workspace");
    if (!useWorkspaceStore.getState().openBrowserTab({ url }))
      throw new Error("Misty Browser could not open this link.");
  });
}
installExternalLinkRouting();
initializeHostLibraryRuntime();
initializeHostAgentsRuntime();

if (
  import.meta.env.MODE !== "mobile" &&
  !isNativeMobileBuild &&
  (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1")
) {
  void import("@/shared/platform/clientDebug").then(({ installClientDebugging }) => {
    installClientDebugging();
  });
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

export const startup = bootstrap();

async function bootstrap() {
  if (new URLSearchParams(location.search).has("agent_worker") && hasTauriInternals()) {
    const [{ AgentWorkerRoot }] = await Promise.all([
      import("@/features/agents/AgentWorkerRoot"),
      import("@/styles/styles.css"),
    ]);
    root.render(
      <TelemetryErrorBoundary>
        <AgentWorkerRoot />
      </TelemetryErrorBoundary>,
    );
    return;
  }
  const { bootstrapDemoSession } = await import("@/features/auth");
  await bootstrapDemoSession();
  void analytics.initialize().then(initializeAnalyticsLifecycle);
  const [{ App }] = await Promise.all([
    import("./App"),
    import("@/styles/styles.css"),
    isNativeMobileBuild ? import("@/styles/mobile.css") : Promise.resolve(),
  ]);
  root.render(
    <TelemetryErrorBoundary>
      <App />
    </TelemetryErrorBoundary>,
  );
}
