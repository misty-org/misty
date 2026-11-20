import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { driveEntryById } from "../drive";
import { driveFileRef } from "../drive/driveAppFiles";
import { useAuth } from "@/features/account";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { EmptyState, notify, Skeleton } from "@misty/ui";
import type { Space } from "../api/dto/entities";
import { appFilesFor } from "./file-picker/chosenFiles";
import { FilePickerDialog } from "./file-picker/FilePickerDialog";
import { SpaceAppFrame } from "./SpaceAppFrame";
import type { AppFileRef } from "./spaceAppFiles";
import { createSpaceAppHandlers, type Source } from "./spaceAppHandlers";
import { themeSource } from "./themeSource";
import { appEntry, catalogSource, runsHere } from "./thirdPartyApps";
import { useSpaceApps } from "./useSpaceApps";

type AppRoute = { path: string; params: Record<string, string> };
/** The route an app starts at: `/`, with the file Open with opened it with as `file`. */
const fixedRoute = (file: string): Source<AppRoute> => {
  const route: AppRoute = { path: "/", params: file ? { file } : {} };
  return { get: () => route, subscribe: () => () => {} };
};

interface PickRequest {
  accept: string[];
  multiple: boolean;
  resolve(files: AppFileRef[]): void;
}

/**
 * An app running in a Space, in a sandboxed frame, with the SDK calls answered here, as this person, in this Space.
 * It runs at the version the Space added, with what its mod approved, and its first open downloads the bundle.
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
  const location = useLocation();
  // Open with: the Space's file the app was opened with. An SDK app reads it from its route; for one that knows
  // only its own Open, it is the answer to the first time it asks for a file.
  const openedWith = new URLSearchParams(location.search).get("file") ?? "";
  const handed = useRef("");
  const { apps } = useSpaceApps(space.id);
  const [pick, setPick] = useState<PickRequest | null>(null);
  // The latest picker request, so a second one answers the first with nothing instead of leaving it waiting.
  const pending = useRef<PickRequest | null>(null);
  const installed = apps?.find((app) => app.app_id === appId);
  const catalog = installed ? appEntry(installed) : undefined;
  const name = catalog?.name ?? appId;
  useWorkspaceViewTitle(workspaceTabId, name);
  const isMod = Boolean(space.permissions?.includes("apps.manage"));
  // A file opened with the app starts it afresh, so its route says that file.
  const spaceKey = `${space.id}:${space.name}:${isMod}:${user?.id}:${installed?.version ?? ""}:${openedWith}`;

  if (!user) return null;
  if (!apps) return <Skeleton className="m-4 h-8 w-48" />;
  if (!installed)
    return (
      <EmptyState
        title="This app isn’t added to the Space"
        line="A mod can add it from the Apps list."
      />
    );

  // An app made only for other computers isn't downloaded here.
  if (catalog && !runsHere(catalog))
    return (
      <EmptyState
        title="Not on this computer"
        line={`${name} isn't made for this computer. It opens on the others it lists.`}
      />
    );

  const finish = (files: AppFileRef[]) => {
    pending.current?.resolve(files);
    pending.current = null;
    setPick(null);
  };

  return (
    <div className="size-full min-h-0">
      <SpaceAppFrame
        key={spaceKey}
        spaceId={space.id}
        appId={appId}
        appName={name}
        version={installed.version}
        approved={installed.permissions ?? []}
        source={catalog ? catalogSource(catalog) : undefined}
        makeHandlers={(manifest) =>
          createSpaceAppHandlers({
            appId,
            appName: name,
            space: { id: space.id, name: space.name, isMod },
            me: {
              user_id: user.id,
              name: user.username,
              role: space.role,
              avatar_version: user.avatarVersion,
            },
            permissions: manifest.permissions,
            theme: themeSource,
            route: fixedRoute(openedWith),
            // An app opens Space pages of the host (a file in Files) with a path; it keeps no page of its own.
            navigate: (route, replace) => navigate(route.path, { replace }),
            files: {
              pickFiles: async (options) => {
                if (openedWith && handed.current !== openedWith) {
                  handed.current = openedWith;
                  // The drive's file Open with opened the app with (a `DriveEntry` id).
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
          purpose="open"
          spaceId={space.id}
          accept={pick.accept}
          multiple={pick.multiple}
          onPick={async (picked) => finish(await appFilesFor(space.id, picked, name))}
          onCancel={() => finish([])}
        />
      ) : null}
    </div>
  );
}
