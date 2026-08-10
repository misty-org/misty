import { useAppStore } from "@/features/app-shell";
import { analytics } from "@/telemetry/client";
import { initializeAnalyticsLifecycle } from "@/telemetry/lifecycle";
import { TelemetryErrorBoundary } from "@/telemetry/TelemetryErrorBoundary";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { configureAssetIconEnvironment } from "@/shared/ui/asset-icon";
import ReactDOM from "react-dom/client";

configureAssetIconEnvironment({
  subscribe: useAppStore.subscribe,
  getSnapshot: () => useAppStore.getState().app?.environment.assetsDir,
});

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

void bootstrap();

async function bootstrap() {
  const { bootstrapDemoSession } = await import("@/features/auth");
  await bootstrapDemoSession();
  void analytics.initialize().then(initializeAnalyticsLifecycle);
  const [{ App }] = await Promise.all([import("./App"), import("@/styles/styles.css")]);
  root.render(
    <TelemetryErrorBoundary>
      <App />
    </TelemetryErrorBoundary>,
  );
}
