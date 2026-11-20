import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/account";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { EmptyState, notify, officialAppById, Skeleton } from "@misty/ui";
import type { Space } from "../api/dto/entities";
import { BUILT_IN_VERSION } from "./appPermissions";
import { PickFilesDialog } from "./PickFilesDialog";
import { SpaceAppFrame } from "./SpaceAppFrame";
import type { AppFileRef } from "./spaceAppFiles";
import { createSpaceAppHandlers, type Source } from "./spaceAppHandlers";
import { themeSource } from "./themeSource";
import { catalogApps, catalogSource } from "./thirdPartyApps";
import { useSpaceApps } from "./useSpaceApps";

const startRoute = { path: "/", params: {} as Record<string, string> };
const fixedRoute: Source<typeof startRoute> = { get: () => startRoute, subscribe: () => () => {} };

interface PickRequest {
  accept: string[];
  multiple: boolean;
  resolve(files: AppFileRef[]): void;
}

/**
 * An app running in a Space, in a sandboxed frame, with the SDK calls answered here, as this person, in this Space.
 * Misty's own apps are built in and get what their manifest asks for; a third-party app runs at the version the
 * Space installed, with what its mod approved, and its first open downloads the bundle.
 */
export function SpaceAppPage({
  space,
  appId,
  workspaceTabId,
}: {
  space: Space;
  appId: string;
  workspaceTabId?: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { apps } = useSpaceApps(space.id);
  const [pick, setPick] = useState<PickRequest | null>(null);
  // The latest picker request, so a second one answers the first with nothing instead of leaving it waiting.
  const pending = useRef<PickRequest | null>(null);
  const builtIn = officialAppById(appId);
  const installed = apps?.find((app) => app.app_id === appId);
  const catalog = catalogApps.find((app) => app.id === appId);
  const name = builtIn?.name ?? catalog?.name ?? appId;
  useWorkspaceViewTitle(workspaceTabId, name);
  const isMod = Boolean(space.permissions?.includes("apps.manage"));
  const spaceKey = `${space.id}:${space.name}:${isMod}:${user?.id}:${installed?.version ?? ""}`;

  if (!user) return null;
  if (!builtIn && !apps) return <Skeleton className="m-4 h-8 w-48" />;
  if (!builtIn && !installed)
    return (
      <EmptyState
        title="This app isn’t added to the Space"
        line="A mod can add it from the Apps list."
      />
    );

  const finish = (files: AppFileRef[]) => {
    pending.current?.resolve(files);
    pending.current = null;
    setPick(null);
  };

  return (
    <>
      <SpaceAppFrame
        key={spaceKey}
        spaceId={space.id}
        appId={appId}
        appName={name}
        version={builtIn ? BUILT_IN_VERSION : (installed?.version ?? "")}
        approved={builtIn ? "manifest" : (installed?.permissions ?? [])}
        source={catalog ? catalogSource(catalog) : undefined}
        makeHandlers={(manifest) =>
          createSpaceAppHandlers({
            appId,
            space: { id: space.id, name: space.name, isMod },
            me: {
              user_id: user.id,
              name: user.username,
              role: space.role,
              avatar_version: user.avatarVersion,
            },
            permissions: manifest.permissions,
            theme: themeSource,
            route: fixedRoute,
            // An app opens Space pages of the host (a file in Media) with a path; it keeps no page of its own.
            navigate: (route, replace) => navigate(route.path, { replace }),
            files: {
              pickFiles: (options) =>
                new Promise<AppFileRef[]>((resolve) => {
                  pending.current?.resolve([]);
                  const request = { ...options, resolve };
                  pending.current = request;
                  setPick(request);
                }),
              saved: (file) => notify({ message: `Saved ${file.name} to Media` }),
            },
          })
        }
      />
      {pick ? (
        <PickFilesDialog
          spaceId={space.id}
          accept={pick.accept}
          multiple={pick.multiple}
          onDone={finish}
        />
      ) : null}
    </>
  );
}
