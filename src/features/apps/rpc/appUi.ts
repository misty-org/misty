import { setAppUnsaved } from "../appUpdateSafety";
import {
  isMistyAppUiMethod,
  mistyAppUiContracts,
  MistyAppSettingsSchema,
  MistyAppCommandSchema,
  commandsForApp,
  MistyDataDomainSchema,
  type MistyDataDomain,
  type MistyAppCommand,
  type MistyAppSettings,
  type MistyWorkspaceOpen,
  type MistyWorkspaceSnapshot,
  type MistyWorkspaceUpdate,
  type MistyWorkspacePlace,
  MistyWorkspaceSnapshotSchema,
} from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";
import { appOwnedRoute } from "../appCapabilityGateway";
import { officialAppSlug } from "../appRoute";

export interface AppUiBackend {
  openWorkspace?(options: MistyWorkspaceOpen): { viewId: string };
  workspaceSnapshot?(): MistyWorkspaceSnapshot;
  updateWorkspace?(change: MistyWorkspaceUpdate): void;
  focusWorkspace?(viewId: string): void;
  closeWorkspace?(viewId: string): void;
  placeWorkspace?(options: MistyWorkspacePlace): void;
  subscribeWorkspace?(listener: () => void): () => void;
  setTitle(title: string): void;
  settings(): MistyAppSettings;
  subscribeSettings(listener: () => void): () => void;
  subscribeData?(domain: MistyDataDomain, listener: () => void): () => void;
  registerShortcut(command: MistyAppCommand, listener: () => void): () => void;
  openExternal(url: string): Promise<void>;
  reportError(message: string): void;
  confirm?(message: string, title?: string): Promise<boolean>;
}
/** Intrinsic methods affect only the calling App's view; links require a grant. */
export function createAppUiRpc(scope: AppRpcScope, backend: AppUiBackend) {
  const subscriptions = new Set<() => void>();
  const close = () => {
    setAppUnsaved(scope.identity.instanceId, false);
    subscriptions.forEach((remove) => remove());
    subscriptions.clear();
  };
  scope.signal.addEventListener("abort", close, { once: true });
  return {
    async request(message: { method: string; params?: unknown }) {
      scope.assert();
      if (!isMistyAppUiMethod(message.method))
        throw new AppRpcError("unsupported_method", "Unknown App UI method.");
      const { method } = message;
      const contract = mistyAppUiContracts[method];
      const params = contract.params.parse(message.params ?? {});
      let result: unknown;
      switch (method) {
        case "workspace.dirty.set":
          setAppUnsaved(scope.identity.instanceId, (params as {dirty:boolean}).dirty);
          break;
        case "workspace.open": {
          scope.assert("navigation.write");
          if (!backend.openWorkspace)
            throw new AppRpcError(
              "unsupported_method",
              "Workspace views are unavailable in this runtime.",
            );
          const input = params as MistyWorkspaceOpen;
          const route = appOwnedRoute(
            input.route,
            officialAppSlug(scope.identity.appId),
            scope.identity.spaceId,
          );
          result = backend.openWorkspace({ ...input, route });
          break;
        }
        case "workspace.snapshot":
          scope.assert("navigation.write");
          if (!backend.workspaceSnapshot)
            throw new AppRpcError("unsupported_method", "Workspace views are unavailable.");
          result = backend.workspaceSnapshot();
          break;
        case "workspace.update":
          scope.assert("navigation.write");
          if (!backend.updateWorkspace)
            throw new AppRpcError("unsupported_method", "Workspace updates are unavailable.");
          backend.updateWorkspace(params as MistyWorkspaceUpdate);
          break;
        case "workspace.focus":
        case "workspace.close": {
          scope.assert("navigation.write");
          const operation =
            method === "workspace.focus" ? backend.focusWorkspace : backend.closeWorkspace;
          if (!operation)
            throw new AppRpcError("unsupported_method", "Workspace control is unavailable.");
          operation((params as { viewId: string }).viewId);
          break;
        }
        case "workspace.place":
          scope.assert("navigation.write");
          if (!backend.placeWorkspace)
            throw new AppRpcError("unsupported_method", "Workspace placement is unavailable.");
          backend.placeWorkspace(params as MistyWorkspacePlace);
          break;
        case "dialogs.confirm": {
          if (!backend.confirm)
            throw new AppRpcError("unsupported_method", "Confirmation dialogs are unavailable.");
          const input = params as { message: string; title?: string };
          result = await backend.confirm(input.message, input.title);
          break;
        }
        case "workspace.title.set":
          backend.setTitle((params as { title: string }).title);
          break;
        case "settings.snapshot":
          result = backend.settings();
          break;
        case "links.openExternal":
          scope.assert("links.open");
          await backend.openExternal((params as { url: string }).url);
          break;
        case "activity.report":
          backend.reportError((params as { message: string }).message);
          break;
      }
      scope.assert();
      return contract.result.parse(result);
    },
    async subscribe(topic: string, listener: (event: unknown) => void) {
      scope.assert();
      const emit = (value: unknown) => {
        try {
          scope.assert();
        } catch {
          return;
        }
        listener(value);
      };
      let remove: () => void;
      if (topic === "workspace") {
        scope.assert("navigation.write");
        if (!backend.subscribeWorkspace || !backend.workspaceSnapshot)
          throw new AppRpcError("unsupported_topic", "Workspace events are unavailable.");
        let previous = JSON.stringify(
          MistyWorkspaceSnapshotSchema.parse(backend.workspaceSnapshot()),
        );
        remove = backend.subscribeWorkspace(() => {
          try {
            scope.assert("navigation.write");
            const snapshot = MistyWorkspaceSnapshotSchema.parse(backend.workspaceSnapshot!());
            const next = JSON.stringify(snapshot);
            if (next !== previous) {
              previous = next;
              emit(snapshot);
            }
          } catch {
            /* A closed view cannot emit workspace state. */
          }
        });
      } else if (topic === "settings") {
        remove = backend.subscribeSettings(() =>
          emit(MistyAppSettingsSchema.parse(backend.settings())),
        );
      } else if (topic.startsWith("data:")) {
        const domain = MistyDataDomainSchema.parse(topic.slice("data:".length));
        const grant = `${domain}.read`;
        scope.assert(grant);
        if (!scope.identity.spaceId || !backend.subscribeData)
          throw new AppRpcError("unsupported_topic", "Space changes are unavailable in this view.");
        remove = backend.subscribeData(domain, () => {
          try {
            scope.assert(grant);
          } catch {
            return;
          }
          // Only an invalidation signal crosses this boundary, never another App's event payload.
          emit({ domain });
        });
      } else if (topic.startsWith("shortcut:")) {
        const command = MistyAppCommandSchema.parse(topic.slice("shortcut:".length));
        if (!commandsForApp(scope.identity.appId).includes(command))
          throw new AppRpcError("capability_denied", "An App can only bind its own commands.");
        remove = backend.registerShortcut(command, () => emit({ command }));
      } else throw new AppRpcError("unsupported_topic", "Unknown App UI event.");
      let removed = false;
      const cleanup = () => {
        if (!removed) {
          removed = true;
          subscriptions.delete(cleanup);
          remove();
        }
      };
      subscriptions.add(cleanup);
      try {
        scope.assert();
      } catch (error) {
        cleanup();
        throw error;
      }
      return cleanup;
    },
    close() {
      scope.signal.removeEventListener("abort", close);
      close();
    },
  };
}
