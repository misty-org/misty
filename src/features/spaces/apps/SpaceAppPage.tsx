import { useEffect, useRef, useState } from "react";
import { leaveViewingPlace, setViewingPlace } from "../list/create_spaces_realtime_actions";
import { useLocation, useNavigate } from "react-router-dom";
import { driveEntryById } from "../drive";
import { driveFileRef } from "../drive/drive_app_files";
import { useAuth } from "@/features/account";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { EmptyState, FramedPage, notify, Skeleton } from "@misty/ui";
import type { Space } from "../api/dto/entities";
import { FilePickerDialog } from "./file-picker/FilePickerDialog";
import { SpaceAppFrame } from "./SpaceAppFrame";
import type { AppFileRef } from "./space_app_files";
import { createSpaceAppHandlers, type Source } from "./space_app_handlers";
import { themeSource } from "./theme_source";
import { appEntry, catalogSource, isSiteApp, runsHere, siteManifest } from "./third_party_apps";
import { useSpaceApps } from "./use_space_apps";

type AppRoute = { path: string; params: Record<string, string> };
const fixedRoute = (file: string): Source<AppRoute> => {
  const route: AppRoute = { path: "/", params: file ? { file } : {} };
  return { get: () => route, subscribe: () => () => {} };
};

interface PickRequest {
  accept: string[];
  multiple: boolean;
  resolve(files: AppFileRef[]): void;
}

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
  const location = useLocation();
  const openedWith = new URLSearchParams(location.search).get("file") ?? "";
  const handed = useRef("");
  useEffect(() => {
    setViewingPlace({ spaceId: space.id, place: "app", itemId: appId });
    return () => leaveViewingPlace("app", appId);
  }, [space.id, appId]);
  const { apps } = useSpaceApps(space.id);
  const [pick, setPick] = useState<PickRequest | null>(null);
  const pending = useRef<PickRequest | null>(null);
  const installed = apps?.find((app) => app.app_id === appId);
  const catalog = installed ? appEntry(installed) : undefined;
  const name = catalog?.name ?? appId;
  useWorkspaceViewTitle(workspaceTabId, name);
  const isMod = Boolean(space.permissions?.includes("apps.manage"));
  const spaceNow = useRef({ name: space.name, isMod });
  spaceNow.current = { name: space.name, isMod };
  const spaceKey = `${space.id}:${user?.id}:${installed?.version ?? ""}:${JSON.stringify(installed?.permissions ?? [])}:${openedWith}`;

  if (!user) return null;
  if (!apps)
    return (
      <FramedPage>
        <Skeleton className="m-4 h-8 w-48" />
      </FramedPage>
    );
  if (!installed)
    return (
      <FramedPage>
        <EmptyState
          title="This app isn’t added to the Space"
          line="A mod can add it from the Apps list."
        />
      </FramedPage>
    );

  if (catalog && !runsHere(catalog))
    return (
      <FramedPage>
        <EmptyState
          title="Not on this computer"
          line={`${name} isn't made for this computer. It opens on the others it lists.`}
        />
      </FramedPage>
    );

  const finish = (files: AppFileRef[]) => {
    pending.current?.resolve(files);
    pending.current = null;
    setPick(null);
  };

  return (
    <FramedPage>
      <SpaceAppFrame
        key={spaceKey}
        spaceId={space.id}
        appId={appId}
        appName={name}
        version={installed.version}
        approved={installed.permissions ?? []}
        source={catalog && !isSiteApp(catalog) ? catalogSource(catalog) : undefined}
        site={catalog && isSiteApp(catalog) ? siteManifest(catalog) : undefined}
        makeHandlers={(manifest) =>
          createSpaceAppHandlers({
            appId,
            appName: name,
            space: {
              id: space.id,
              get name() {
                return spaceNow.current.name;
              },
              get isMod() {
                return spaceNow.current.isMod;
              },
            },
            me: {
              user_id: user.id,
              name: user.username,
              role: space.role,
              avatar_version: user.avatarVersion,
            },
            permissions: manifest.permissions,
            theme: themeSource,
            route: fixedRoute(openedWith),
            navigate: (route, replace) => navigate(route.path, { replace }),
            files: {
              pickFiles: async (options) => {
                if (openedWith && handed.current !== openedWith) {
                  handed.current = openedWith;
                  const file = await driveEntryById(space.id, openedWith).then(
                    (entry) => (entry ? driveFileRef(entry) : undefined),
                    () => undefined,
                  );
                  if (file) return [file];
                }
                return new Promise<AppFileRef[]>((resolve) => {
                  pending.current?.resolve([]);
                  const request = { ...options, resolve };
                  pending.current = request;
                  setPick(request);
                });
              },
              saved: (file, how) =>
                notify({
                  message:
                    how === "kept"
                      ? `Someone else saved this file meanwhile, so yours is kept as ${file.name}`
                      : `Saved ${file.name} to Files`,
                }),
            },
          })
        }
      />
      {pick ? (
        <FilePickerDialog
          spaceId={space.id}
          appName={name}
          accept={pick.accept}
          multiple={pick.multiple}
          onPick={finish}
          onCancel={() => finish([])}
        />
      ) : null}
    </FramedPage>
  );
}
