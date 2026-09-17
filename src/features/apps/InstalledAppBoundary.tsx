import { LoadingScreen } from "@/shared/ui/loading-screen";
import { useAuth } from "@/features/auth";
import { Button, EmptyState } from "@/shared/ui";
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAppsStore } from "./useAppsStore";

export function InstalledAppBoundary(props: {
  appId: string;
  appName?: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const ready = useAppsStore((state) => state.ready);
  const loading = useAppsStore((state) => state.loading);
  const error = useAppsStore((state) => state.error);
  const installed = useAppsStore((state) =>
    state.installations.some((item) => item.app_id === props.appId && item.state === "installed"),
  );
  const catalogName = useAppsStore(
    (state) => state.catalog.find((app) => app.id === props.appId)?.name,
  );
  const appName = props.appName ?? catalogName ?? "This app";

  useEffect(() => {
    if (user?.id && !ready && !loading && !error) void useAppsStore.getState().load(user.id, false);
  }, [loading, ready, user?.id, error]);

  if (!ready) {
    if (error) {
      return (
        <EmptyState
          className="h-full"
          title="Apps could not be checked"
          description={error}
          action={
            <Button onClick={() => user?.id && void useAppsStore.getState().load(user.id, true)}>
              Try again
            </Button>
          }
        />
      );
    }
    return <LoadingScreen label="Checking installed apps" />;
  }

  if (!installed) {
    return (
      <EmptyState
        className="h-full"
        title={`${appName} is not installed`}
        description={`Install ${appName} from Discover to use it.`}
        action={<Button onClick={() => navigate("/discover")}>Open Discover</Button>}
      />
    );
  }

  return props.children;
}
