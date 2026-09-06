import { useAuth } from "@/features/auth";
import { Button, EmptyState } from "@/shared/ui";
import { LoaderCircle } from "lucide-react";
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
    state.installations.some(
      (installation) => installation.app_id === props.appId && installation.state === "installed",
    ),
  );
  const catalogName = useAppsStore(
    (state) => state.catalog.find((app) => app.id === props.appId)?.name,
  );
  const appName = props.appName ?? catalogName ?? "This app";

  useEffect(() => {
    if (user?.id && !ready && !loading) void useAppsStore.getState().load(user.id);
  }, [loading, ready, user?.id]);

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
    return (
      <div className="grid h-full place-items-center" role="status">
        <LoaderCircle className="animate-spin text-cream-muted" size={22} aria-hidden="true" />
        <span className="sr-only">Checking installed apps</span>
      </div>
    );
  }

  if (!installed) {
    return (
      <EmptyState
        className="h-full"
        title={`Add ${appName} to Misty to open it`}
        description={`Add ${appName} from Discover when you want to use it.`}
        action={<Button onClick={() => navigate("/discover")}>Open Discover</Button>}
      />
    );
  }

  return props.children;
}
