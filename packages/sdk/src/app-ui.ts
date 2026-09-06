import {
  mistyAppUiContracts,
  MistyAppCommandSchema,
  MistyAppSettingsSchema,
  MistyDataDomainSchema,
  MistyDataChangeSchema,
  type MistyDataDomain,
  type MistyAppUiMethod,
  type MistyAppUiParams,
  type MistyAppUiResult,
  type MistyAppCommand,
  type MistyAppSettings,
  type MistyWorkspaceOpen,
  type MistyWorkspaceUpdate,
  type MistyWorkspacePlace,
  type MistyWorkspaceSnapshot,
  MistyWorkspaceSnapshotSchema,
} from "@misty/contracts";
import {
  MistySDKError,
  type MistyAppTransport,
  type MistyCall,
} from "./transport.js";
export * from "@misty/contracts";

export function createAppUiSDK(call: MistyCall, transport: MistyAppTransport) {
  const request = async <M extends MistyAppUiMethod>(
    method: M,
    params: MistyAppUiParams<M>,
  ): Promise<MistyAppUiResult<M>> => {
    const contract = mistyAppUiContracts[method];
    return contract.result.parse(
      await call(method, contract.params.parse(params)),
    ) as MistyAppUiResult<M>;
  };
  const subscribe = (topic: string, callback: (event: unknown) => void) => {
    if (!transport.subscribe)
      throw new MistySDKError(
        "unsupported_transport",
        "This runtime does not support App events.",
      );
    return transport.subscribe(topic, callback);
  };
  return {
    dialogs: Object.freeze({
      confirm: (message: string, title?: string) =>
        request("dialogs.confirm", { message, title }),
    }),
    data: Object.freeze({
      subscribe: (domain: MistyDataDomain, callback: () => void) =>
        subscribe(`data:${MistyDataDomainSchema.parse(domain)}`, (event) => {
          if (MistyDataChangeSchema.parse(event).domain === domain) callback();
        }),
    }),
    workspace: Object.freeze({
      setUnsavedChanges: (dirty: boolean) => request("workspace.dirty.set", { dirty }),
      snapshot: () => request("workspace.snapshot", {}),
      update: (change: MistyWorkspaceUpdate) => request("workspace.update", change),
      focus: (viewId: string) => request("workspace.focus", { viewId }),
      close: (viewId: string) => request("workspace.close", { viewId }),
      place: (options: MistyWorkspacePlace) => request("workspace.place", options),
      subscribe: (callback: (snapshot: MistyWorkspaceSnapshot) => void) => subscribe("workspace", event => callback(MistyWorkspaceSnapshotSchema.parse(event))),
      open: (options: MistyWorkspaceOpen) => request("workspace.open", options),
      setTitle: (title: string) => request("workspace.title.set", { title }),
    }),
    settings: Object.freeze({
      snapshot: () => request("settings.snapshot", {}),
      subscribe: (callback: (settings: MistyAppSettings) => void) =>
        subscribe("settings", (event) =>
          callback(MistyAppSettingsSchema.parse(event)),
        ),
    }),
    shortcuts: Object.freeze({
      register: (command: MistyAppCommand, callback: () => void) =>
        subscribe(`shortcut:${MistyAppCommandSchema.parse(command)}`, () =>
          callback(),
        ),
    }),
    links: Object.freeze({
      openExternal: (url: string) => request("links.openExternal", { url }),
    }),
    activity: Object.freeze({
      report: (message: string) => request("activity.report", { message }),
    }),
  };
}
export type MistyAppUiSDK = ReturnType<typeof createAppUiSDK>;
