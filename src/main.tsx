import ReactDOM from "react-dom/client";
import { isNativeMobileBuild } from "./platform/buildTarget";
import { analytics } from "./analytics/client";
import { initializeAnalyticsLifecycle } from "./analytics/lifecycle";
import { TelemetryErrorBoundary } from "./analytics/TelemetryErrorBoundary";

if (
  import.meta.env.MODE !== "mobile" &&
  !isNativeMobileBuild &&
  (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1")
) {
  void import("./shared/debug/clientDebug").then(
    ({ installClientDebugging }) => {
      installClientDebugging();
    },
  );
}

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

void bootstrap();

async function bootstrap() {
  void analytics.initialize().then(initializeAnalyticsLifecycle);
  const [{ App }] = await Promise.all([
    import("./App"),
    import("./styles.css"),
  ]);
  root.render(
    <TelemetryErrorBoundary>
      <App />
    </TelemetryErrorBoundary>,
  );
}
