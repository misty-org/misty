import type { OfficialApp, OfficialAppSession } from "@/api/apps";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { AuthUser } from "@/features/auth/authSession";
import type { WorkspaceTab } from "@/features/workspace/model";
import { useMemo, useRef, useState } from "react";
import { NativeAppView } from "./NativeAppView";
import { executeAppCapability } from "./appCapabilityGateway";
import { useAppThemeStore } from "@/features/settings";

export interface MiniAppRuntimeProps {
  app: OfficialApp;
  session: OfficialAppSession;
  source: URL;
  serverBase: string;
  apiBase: string;
  user: AuthUser;
  space?: Space;
  tab?: WorkspaceTab;
  active?: boolean;
  route: string;
  search: string;
  onNavigate?: (route: string) => void;
}

/** Compatibility name for installed packages; rendering is always a native view. */
export function OfficialAppPackageHost(props: MiniAppRuntimeProps) {
  const identity = JSON.stringify([
    props.user.id,
    props.serverBase,
    props.app.id,
    props.session.space_id,
    [...props.session.scopes].sort(),
  ]);
  return <NativePackageInstance key={identity} {...props} />;
}

function NativePackageInstance(props: MiniAppRuntimeProps) {
  const protocolInstance = useRef(`misty-app-${crypto.randomUUID()}`);
  const theme = useAppThemeStore((state) => state.resolvedTheme);
  const [notice, setNotice] = useState("");
  const source = useMemo(
    () => appDocumentUrl(props.source, props.app.id, protocolInstance.current).href,
    [props.source, props.app.id],
  );
  // Never export settings documents, account credentials, API tokens, or host commands.
  const context = useMemo(
    () => ({
      type: "misty:app-host-update",
      protocol: 2,
      appId: props.app.id,
      instanceId: protocolInstance.current,
      props: {
        instanceId: protocolInstance.current,
        session: {
          appId: props.session.app_id,
          spaceId: props.session.space_id ?? "",
          scopes: props.session.scopes,
          expiresAt: props.session.expires_at,
        },
        user: { id: props.user.id },
        space:
          props.space && props.session.scopes.includes("spaces.read")
            ? { id: props.space.id, name: props.space.name }
            : undefined,
        tab: props.tab,
        active: props.active ?? true,
        platform: "desktop",
        route: props.route,
        search: props.search,
        resolvedTheme: theme,
        settingsDocument: {},
      },
    }),
    [
      props.active,
      props.app.id,
      props.route,
      props.search,
      props.session,
      props.space,
      props.tab,
      props.user.id,
      theme,
    ],
  );
  return (
    <div className="relative h-full min-h-0" data-misty-app-host={props.app.id}>
      <NativeAppView
        source={source}
        owner={{ accountId: props.user.id, spaceId: props.session.space_id || undefined }}
        title={props.app.name}
        active={props.active}
        context={context}
        scopeLimit={props.session.scopes.filter((scope) => props.app.scopes.includes(scope))}
        expiresAt={props.session.expires_at}
        onRequest={async (message, signal) => {
          if (typeof message.method !== "string" || !message.method || message.method.length > 120)
            throw new Error("This App request is not supported. Use the capability API.");
          return executeAppCapability(
            {
              app: props.app,
              signal,
              session: props.session,
              serverBase: props.serverBase,
              user: props.user,
              space: props.space,
              tab: props.tab,
              platform: "desktop",
              navigate: props.onNavigate,
              showToast: (text) => setNotice(text),
            },
            message.method,
            message.params,
          );
        }}
      />
      {notice ? <div role="status">{notice}</div> : null}
    </div>
  );
}

export function appDocumentUrl(source: URL, appId: string, instanceId: string, attempt = 0): URL {
  const result = new URL(source.href);
  result.searchParams.set("mistyAppId", appId);
  result.searchParams.set("mistyAppInstance", instanceId);
  if (attempt > 0) result.searchParams.set("mistyReload", String(attempt));
  return result;
}
