import { useAuth } from "@/features/auth";
import { Button, EmptyState } from "@/shared/ui";
import { LoaderCircle } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { canManageSpaceApps, useAppsStore } from "./useAppsStore";

export function InstalledAppBoundary(props: {
  appId: string;
  appName?: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const activeSpaceId = useAppsStore((state) => state.spaceId);
  const spaceId = params.spaceId ?? activeSpaceId;
  const ready = useAppsStore((state) => state.bySpace[spaceId] !== undefined);
  const manager = canManageSpaceApps(spaceId);
  const loading = useAppsStore((state) => state.loading);
  const error = useAppsStore((state) => state.bySpaceErrors[spaceId] ?? "");
  const installed = useAppsStore((state) =>
    (state.bySpace[spaceId] ?? []).some(
      (installation) => installation.app_id === props.appId && installation.state === "installed",
    ),
  );
  const catalogName = useAppsStore(
    (state) => state.catalog.find((app) => app.id === props.appId)?.name,
  );
  const appName = props.appName ?? catalogName ?? "This app";

  useEffect(() => {
    if (user?.id && !ready && !loading && !error)
      void useAppsStore.getState().load(user.id, false, spaceId);
  }, [loading, ready, user?.id, spaceId, error]);

  if (!ready) {
    if (error) {
      return (
        <EmptyState
          className="h-full"
          title="Apps could not be checked"
          description={error}
          action={
            <Button
              onClick={() => user?.id && void useAppsStore.getState().load(user.id, true, spaceId)}
            >
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
        title={`${appName} is not available in this Space`}
        description={
          manager
            ? `Add ${appName} from Discover to use it here.`
            : "A Space manager needs to add this app before members can use it."
        }
        action={
          manager ? <Button onClick={() => navigate("/discover")}>Open Discover</Button> : undefined
        }
      />
    );
  }

  return props.children;
}
