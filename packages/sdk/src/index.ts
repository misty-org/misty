import { createDocumentsSDK, type MistyDocumentsSDK } from "./documents.js";
export * from "./documents.js";
import { createFileSystemSDK, type MistyFileSystemSDK } from "./file-system.js";
export * from "./file-system.js";
import { createCodeControlsSDK } from "./code-controls.js";
import { createCapabilitiesSDK, type MistyCapabilitiesSDK } from "./capabilities.js";
export * from "./capabilities.js";
export * from "./routines.js";
import {createAgentsSDK,type MistyAgentsSDK} from "./agents.js";
import {createSocialSDK,type MistySocialSDK} from "./social.js";
import {createLibrarySDK,type MistyLibrarySDK} from "./library.js";
export * from "./library.js";
import {createFileHostSDK, type MistyFileHostSDK} from "./file-host.js";
export * from "./file-host.js";
import { createFilePreviewSDK, type MistyFilePreviewSDK } from "./file-preview.js";
export * from "./file-preview.js";
import { createFileEditingSDK, type MistyFileEditingSDK } from "./file-editing.js";
export * from "./file-editing.js";
import { createCodeLspSDK, type MistyCodeLspSDK } from "./code-lsp.js";
export * from "./code-lsp.js";
import { createDirectorySDK, type MistyDirectorySDK } from "./directories.js";
export * from "./directories.js";
import { createTextFileSDK, type MistyTextFileSDK } from "./text-files.js";
import { createFileObservationSDK, type MistyFileObservationSDK } from "./file-observation.js";
import { createFileTransferSDK, type MistyFileTransferSDK } from "./file-transfers.js";
export * from "./file-transfers.js";
export * from "./file-observation.js";
export * from "./text-files.js";
import { createAiControlsSDK, type MistyAiControlsSDK } from "./ai-controls.js";
import { createMailCacheSDK, type MistyMailCacheSDK } from "./mail-cache.js";
export * from "./mail-cache.js";
import { writeClipboardImage, readClipboardImage } from "./clipboard.js";
export * from "./ai-controls.js";
import { createJournalAssetsSDK, type MistyJournalAssetsSDK } from "./journal-assets.js";
export * from "./journal-assets.js";
import type { MistySurfaceAdapter } from "./surfaces.js";
export * from "./surfaces.js";
import { createAppUiSDK, type MistyAppUiSDK } from "./app-ui.js";
export * from "./app-ui.js";
import type {
  MistyMethodParams,
  SpaceNote,
  SpaceDrawing,
  JournalTicket,
} from "@misty/contracts";
export * from "./component.js";
import { createServerSDK, type MistyServerSDK } from "./server.js";
export * from "./server.js";
import { createTerminalSDK, type MistyTerminalSDK } from "./terminal.js";
import { createBrowserSDK, type MistyBrowserSDK } from "./browser.js";
export * from "./browser.js";
import { createCollaborationSDK, type MistyCollaborationSDK } from "./collaboration.js";
export * from "./collaboration.js";
export * from "./collaboration-socket.js";
import { MistySDKError, type MistyAppTransport } from "./transport.js";
export * from "./terminal.js";
export * from "./transport.js";

export const MISTY_APP_PROTOCOL_VERSION = 2 as const;

export interface MistyAppRequest<T = unknown> {
  readonly type: "misty:app-rpc";
  readonly protocol: typeof MISTY_APP_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly method: string;
  readonly params: T;
}

export interface MistyAppResponse<T = unknown> {
  readonly type: "misty:app-rpc-response";
  readonly protocol: typeof MISTY_APP_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface MistyAppContext {
  readonly appId: string;
  readonly slug: string;
  readonly version: string;
  readonly platform: "desktop" | "ios" | "web";
  /** Opaque ID for the calling account; never includes its credentials or email. */
  readonly user?: { readonly id: string };
  readonly space?: { readonly id: string; readonly name: string };
}

export interface MistyAppRuntimeIdentity {
  readonly appId: string;
  readonly instanceId: string;
}

export interface MistyAppDefinition {
  /** Declarative only; the verified installation must authorize these providers. */
  capabilities?: import("@misty/contracts").MistyCapabilityManifest;
  mount(input: {
    readonly root: HTMLElement;
    readonly misty: MistyAppSDK;
  }): void | (() => void) | Promise<void | (() => void)>;
}

export interface MistyNavigationItem {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  readonly children?: readonly MistyNavigationItem[];
}

export interface MistyAppearanceResult {
  readonly ok: boolean;
  readonly themeId?: string;
  readonly tokens?: Record<string, string>;
  readonly message?: string;
}

export interface MistyFileHandle {
  readonly handle: string;
  readonly name: string;
  readonly bytes: number;
}

export interface MistyMediaStatus {
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly message: string;
}
export interface MistyBackupJob {
  readonly id?: string;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly message: string;
  readonly result?: {
    readonly snapshots?: readonly {
      readonly id: string;
      readonly time: string;
    }[];
    readonly folder?: string;
    readonly verified?: boolean;
    readonly report?: {
      readonly files: number;
      readonly directories: number;
      readonly links: number;
      readonly bytes: number;
    };
  } | null;
}
export interface MistyDownloadJob {
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly message: string;
  readonly result?: {
    readonly title?: string;
    readonly uploader?: string;
    readonly duration?: string;
    readonly playlistCount?: number;
    readonly outputs?: readonly {
      readonly name: string;
      readonly bytes: number;
    }[];
  } | null;
}
export interface MistyAppSDK extends MistyAppUiSDK {
  readonly documents: MistyDocumentsSDK;
  readonly fileSystem: MistyFileSystemSDK;
 readonly capabilities: MistyCapabilitiesSDK;
 readonly agents:MistyAgentsSDK;
 readonly library:MistyLibrarySDK;
 readonly social:MistySocialSDK;
  readonly browser: MistyBrowserSDK;
  readonly ai: MistyAiControlsSDK;
  readonly journal: { readonly assets: MistyJournalAssetsSDK };
  readonly mail: { readonly cache: MistyMailCacheSDK };
  readonly surfaces: {
    register(adapter: MistySurfaceAdapter): Promise<() => void>;
  };
  readonly server: MistyServerSDK;
  readonly terminal: MistyTerminalSDK;
  readonly code: ReturnType<typeof createCodeControlsSDK> & { readonly lsp: MistyCodeLspSDK };
  readonly backups: {
    status(): Promise<{ available: boolean; format: string; message?: string }>;
    repositoryOpen(options: {
      directory: string;
      create?: boolean;
      name?: string;
    }): Promise<{ repository: string; name: string }>;
    repositoryClose(repository: string): Promise<void>;
    backupStart(
      repository: string,
      sources: readonly string[],
    ): Promise<{ jobId: string }>;
    restoreStart(
      repository: string,
      snapshot: string,
      destination: string,
    ): Promise<{ jobId: string }>;
    snapshotsStart(repository: string): Promise<{ jobId: string }>;
    checkStart(repository: string): Promise<{ jobId: string }>;
    jobStatus(jobId: string): Promise<MistyBackupJob>;
    jobCancel(jobId: string): Promise<void>;
    jobClose(jobId: string): Promise<void>;
  };
  readonly downloads: {
    status(): Promise<{
      available: boolean;
      formats: string[];
      message?: string;
    }>;
    inspectStart(url: string, playlist: boolean): Promise<{ jobId: string }>;
    downloadStart(options: {
      url: string;
      format: "mp3" | "m4a" | "mp4" | "webm";
      playlist: boolean;
      directory: string;
    }): Promise<{ jobId: string }>;
    jobStatus(jobId: string): Promise<MistyDownloadJob>;
    jobCancel(jobId: string): Promise<void>;
    jobClose(jobId: string): Promise<void>;
  };
  readonly media: {
    status(): Promise<{
      available: boolean;
      formats: string[];
      message?: string;
    }>;
    convertStart(options: {
      handle: string;
      directory: string;
      name: string;
      format: string;
      quality: "small" | "balanced" | "high";
    }): Promise<{ jobId: string }>;
    convertStatus(jobId: string): Promise<MistyMediaStatus>;
    convertCancel(jobId: string): Promise<void>;
    convertCollect(jobId: string): Promise<MistyFileHandle>;
    convertClose(jobId: string): Promise<void>;
  };
  readonly appearance: {
    snapshot(): Promise<MistyAppearanceResult>;
    preview(tokens: Record<string, string>): Promise<MistyAppearanceResult>;
    apply(
      tokens: Record<string, string>,
      preset?: string,
    ): Promise<MistyAppearanceResult>;
    preset(preset: string): Promise<MistyAppearanceResult>;
    revert(): Promise<MistyAppearanceResult>;
  };
  readonly context: { get(): Promise<MistyAppContext> };
  readonly permissions: {
    list(): Promise<string[]>;
    revoke(capability: string): Promise<string[]>;
  };
  readonly files: MistyFileHostSDK & MistyFilePreviewSDK & MistyFileEditingSDK & MistyDirectorySDK & MistyTextFileSDK & MistyFileObservationSDK & MistyFileTransferSDK & {
    pick(options?: { write?: boolean }): Promise<MistyFileHandle | null>;
    release(handle: string): Promise<void>;
    pickMany(): Promise<MistyFileHandle[]>;
    readBytes(
      handle: string,
      offset: number,
      length: number,
    ): Promise<ArrayBuffer>;
    createCopy(directory: string, name: string): Promise<{ handle: string }>;
    appendCopy(handle: string, bytes: ArrayBuffer): Promise<void>;
    commitCopy(handle: string): Promise<{ name: string; bytes: number }>;
    discardCopy(handle: string): Promise<void>;
    pickDirectory(options?: {
      write?: boolean;
    }): Promise<{ handle: string; name: string } | null>;
    scanStart(handle: string): Promise<{ jobId: string }>;
    scanStatus(jobId: string): Promise<MistyFileScan>;
    scanCancel(jobId: string): Promise<void>;
    scanClose(jobId: string): Promise<void>;
  };
  readonly clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
    writeImage(file: Blob): Promise<void>;
    readImage(): Promise<Blob | null>;
  };
  readonly network: {
    fetch(
      url: string,
      options?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | ArrayBuffer;
      },
    ): Promise<Response>;
  };
  readonly microphone: {
    capture(
      seconds?: number,
    ): Promise<{ mimeType: string; bytes: ArrayBuffer }>;
  };
  readonly camera: {
    capture(
      seconds?: number,
    ): Promise<{ mimeType: string; bytes: ArrayBuffer }>;
  };

  readonly storage: {
    readonly local: MistyStorageArea;
    readonly sync: MistyStorageArea;
  };
  readonly navigation: {
    setItems(items: readonly MistyNavigationItem[]): Promise<void>;
    open(route: string): Promise<void>;
  };
  readonly ui: {
    toast(
      message: string,
      tone?: "neutral" | "success" | "error",
    ): Promise<void>;
  };
  readonly notes: {
    list(): Promise<readonly SpaceNote[]>;
    get(noteId: string): Promise<SpaceNote>;
    create(
      input: MistyMethodParams<"notes.create">["body"],
    ): Promise<SpaceNote>;
    update(
      noteId: string,
      input: MistyMethodParams<"notes.update">["body"],
    ): Promise<SpaceNote>;
    archive(noteId: string): Promise<void>;
  };
  readonly drawings: {
    list(): Promise<readonly SpaceDrawing[]>;
    get(drawingId: string): Promise<SpaceDrawing>;
    create(
      input: MistyMethodParams<"drawings.create">["body"],
    ): Promise<SpaceDrawing>;
    update(
      drawingId: string,
      input: MistyMethodParams<"drawings.update">["body"],
    ): Promise<SpaceDrawing>;
  };
  readonly assets: {
    reserve(input: unknown): Promise<unknown>;
    finalize(input: unknown): Promise<unknown>;
    download(assetId: string): Promise<unknown>;
  };
  readonly collaboration: MistyCollaborationSDK & {
    /** @deprecated Downloaded components use leased open/send/close connections. */
    createTicket(
      resource: "note" | "drawing",
      resourceId: string,
    ): Promise<JournalTicket>;
  };
}

export interface MistyStorageArea {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

export interface MistyFileScan {
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly message: string;
  readonly result: null | {
    readonly root: string;
    readonly bytes: number;
    readonly files: number;
    readonly folders: number;
    readonly skipped: number;
    readonly truncated: boolean;
    readonly largest: readonly {
      path: string;
      name: string;
      bytes: number;
      kind: string;
    }[];
    readonly types: readonly { kind: string; bytes: number; files: number }[];
  };
}

export function connectMistyApp(): MistyAppSDK {
  const transport = (
    window as Window & {
      mistyHost?: {
        request(message: {
          method: string;
          params?: unknown;
        }): Promise<unknown>;
      };
    }
  ).mistyHost;
  if (!transport)
    throw new Error("Open this App in Misty's native App runtime.");
  return createMistyAppSDK(transport);
}

/** Construct an SDK for an app-bound transport without relying on a Window or frame. */
export function createMistyAppSDK(transport: MistyAppTransport): MistyAppSDK {
  const call = <T>(method: string, params: unknown = {}): Promise<T> =>
    transport.request({ method, params }) as Promise<T>;
  const storage = (area: "local" | "sync"): MistyStorageArea => ({
    get: (key) => call(`storage.${area}.get`, { key }),
    set: (key, value) => call(`storage.${area}.set`, { key, value }),
    delete: (key) => call(`storage.${area}.delete`, { key }),
    keys: () => call(`storage.${area}.keys`),
  });
  const server = createServerSDK(call);
  const sdk = Object.freeze({
    documents: createDocumentsSDK(call),
    fileSystem: createFileSystemSDK(call, transport),
    capabilities: createCapabilitiesSDK(server),
    ...createAppUiSDK(call, transport),
    surfaces: {
      register: async (adapter: MistySurfaceAdapter) => {
        if (!transport.registerSurface)
          throw new MistySDKError(
            "unsupported_transport",
            "This Misty runtime does not support component AI surfaces.",
          );
        return transport.registerSurface(adapter);
      },
    },
    agents:createAgentsSDK(call,transport),
 library:createLibrarySDK(call),
 social:createSocialSDK(call,transport),
    terminal: createTerminalSDK(call, transport),
    code: { ...createCodeControlsSDK(call), lsp: createCodeLspSDK(call, transport) },
    browser: createBrowserSDK(call, transport),
    ai: createAiControlsSDK(call, transport),
    journal: Object.freeze({ assets: createJournalAssetsSDK(call) }),
    mail: Object.freeze({ cache: createMailCacheSDK(call) }),
    server,
    backups: {
      status: () => call("backups.status"),
      repositoryOpen: (options: {
        directory: string;
        create?: boolean;
        name?: string;
      }) => call("backups.repositoryOpen", options),
      repositoryClose: (repository: string) =>
        call("backups.repositoryClose", { repository }),
      backupStart: (repository: string, sources: readonly string[]) =>
        call("backups.backupStart", { repository, sources }),
      restoreStart: (
        repository: string,
        snapshot: string,
        destination: string,
      ) => call("backups.restoreStart", { repository, snapshot, destination }),
      snapshotsStart: (repository: string) =>
        call("backups.snapshotsStart", { repository }),
      checkStart: (repository: string) =>
        call("backups.checkStart", { repository }),
      jobStatus: (jobId: string) => call("backups.jobStatus", { jobId }),
      jobCancel: (jobId: string) => call("backups.jobCancel", { jobId }),
      jobClose: (jobId: string) => call("backups.jobClose", { jobId }),
    },
    downloads: {
      status: () => call("downloads.status"),
      inspectStart: (url: string, playlist: boolean) =>
        call("downloads.inspectStart", { url, playlist }),
      downloadStart: (options: {
        url: string;
        format: "mp3" | "m4a" | "mp4" | "webm";
        playlist: boolean;
        directory: string;
      }) => call("downloads.downloadStart", options),
      jobStatus: (jobId: string) => call("downloads.jobStatus", { jobId }),
      jobCancel: (jobId: string) => call("downloads.jobCancel", { jobId }),
      jobClose: (jobId: string) => call("downloads.jobClose", { jobId }),
    },
    media: {
      status: () => call("media.status"),
      convertStart: (options: {
        handle: string;
        directory: string;
        name: string;
        format: string;
        quality: "small" | "balanced" | "high";
      }) => call("media.convertStart", options),
      convertStatus: (jobId: string) => call("media.convertStatus", { jobId }),
      convertCancel: (jobId: string) => call("media.convertCancel", { jobId }),
      convertCollect: (jobId: string) =>
        call("media.convertCollect", { jobId }),
      convertClose: (jobId: string) => call("media.convertClose", { jobId }),
    },
    appearance: {
      snapshot: () => call("appearance.snapshot"),
      preview: (tokens: Record<string, string>) =>
        call("appearance.preview", { tokens }),
      apply: (tokens: Record<string, string>, preset?: string) =>
        call("appearance.apply", { tokens, preset }),
      preset: (preset: string) =>
        call("appearance.preset", { preset, preview: true }),
      revert: () => call("appearance.revert"),
    },
    context: { get: () => call("context.get") },
    permissions: {
      list: () => call("permissions.list"),
      revoke: (capability: string) =>
        call("permissions.revoke", { capability }),
    },
    files: {
      ...createFileHostSDK(call, transport),
      ...createFilePreviewSDK(call),
      ...createFileEditingSDK(call),
      ...createDirectorySDK(call),
      ...createTextFileSDK(call),
      ...createFileObservationSDK(call),
      ...createFileTransferSDK(call),
      pick: (options: { write?: boolean } = {}) => call("files.pick", options),
      release: (handle: string) => call("files.release", { handle }),
      pickMany: () => call("files.pickMany"),
      readBytes: (handle: string, offset: number, length: number) =>
        call("files.readBytes", { handle, offset, length }),
      createCopy: (directory: string, name: string) =>
        call("files.createCopy", { directory, name }),
      appendCopy: (handle: string, bytes: ArrayBuffer) =>
        call("files.appendCopy", { handle, bytes }),
      commitCopy: (handle: string) => call("files.commitCopy", { handle }),
      discardCopy: (handle: string) => call("files.discardCopy", { handle }),
      pickDirectory: (options: { write?: boolean } = {}) =>
        call("files.pickDirectory", options),
      scanStart: (handle: string) => call("files.scanStart", { handle }),
      scanStatus: (jobId: string) => call("files.scanStatus", { jobId }),
      scanCancel: (jobId: string) => call("files.scanCancel", { jobId }),
      scanClose: (jobId: string) => call("files.scanClose", { jobId }),
    },
    clipboard: {
      readText: async () =>
        (await call<{ text: string }>("clipboard.readText")).text,
      writeText: (text: string) => call("clipboard.writeText", { text }),
      writeImage: (file: Blob) => writeClipboardImage(transport, file),
      readImage: () => readClipboardImage(transport),
    },
    network: {
      fetch: async (
        url: string,
        options: {
          method?: string;
          headers?: Record<string, string>;
          body?: string | ArrayBuffer;
        } = {},
      ) => {
        const result = await call<{
          status: number;
          headers: [string, string][];
          body: ArrayBuffer;
        }>("network.fetch", { url, ...options });
        return new Response(
          [204, 205, 304].includes(result.status) || options.method === "HEAD"
            ? null
            : result.body,
          { status: result.status, headers: result.headers },
        );
      },
    },
    microphone: {
      capture: (seconds = 5) => call("microphone.capture", { seconds }),
    },
    camera: { capture: (seconds = 5) => call("camera.capture", { seconds }) },

    storage: { local: storage("local"), sync: storage("sync") },
    navigation: {
      setItems: (items: readonly MistyNavigationItem[]) =>
        call("navigation.setItems", { items }),
      open: (route: string) => call("navigation.open", { route }),
    },
    ui: {
      toast: (
        message: string,
        tone: "neutral" | "success" | "error" = "neutral",
      ) => call("ui.toast", { message, tone }),
    },
    notes: {
      list: async () => (await server.call("notes.list")).notes ?? [],
      get: (noteID: string) => server.call("notes.get", { path: { noteID } }),
      create: (body: MistyMethodParams<"notes.create">["body"]) =>
        server.call("notes.create", { body }),
      update: (
        noteID: string,
        body: MistyMethodParams<"notes.update">["body"],
      ) => server.call("notes.update", { path: { noteID }, body }),
      archive: (noteID: string) =>
        server.call("notes.archive", {
          path: { noteID },
          body: { archived: true },
        }),
    },
    drawings: {
      list: async () => (await server.call("drawings.list")).drawings ?? [],
      get: (drawingID: string) =>
        server.call("drawings.get", { path: { drawingID } }),
      create: (body: MistyMethodParams<"drawings.create">["body"]) =>
        server.call("drawings.create", { body }),
      update: (
        drawingID: string,
        body: MistyMethodParams<"drawings.update">["body"],
      ) => server.call("drawings.update", { path: { drawingID }, body }),
    },
    assets: {
      reserve: (input: unknown) => call("assets.reserve", input),
      finalize: (input: unknown) => call("assets.finalize", input),
      download: (assetId: string) => call("assets.download", { assetId }),
    },
    collaboration: {
      ...createCollaborationSDK(call, transport),
      createTicket: (resource: "note" | "drawing", resourceId: string) =>
        resource === "note"
          ? server.call("notes.collaboration.ticket", {
              path: { noteID: resourceId },
            })
          : server.call("drawings.collaboration.ticket", {
              path: { drawingID: resourceId },
            }),
    },
  }) as MistyAppSDK;
  void call("lifecycle.ready").catch(() => undefined);
  return sdk;
}

/**
 * Starts a Misty App from its ES-module entry. The SDK is the only supported
 * way for App code to communicate with Misty; host transports and credentials
 * are intentionally not exposed.
 */
export async function defineApp(definition: MistyAppDefinition): Promise<void> {
  const root = document.getElementById("misty-app-root");
  if (!root)
    throw new Error("The Misty App document is missing #misty-app-root.");
  const cleanup = await definition.mount({ root, misty: connectMistyApp() });
  if (typeof cleanup === "function")
    window.addEventListener("pagehide", cleanup, { once: true });
}

export function readMistyAppRuntimeIdentity(
  url = window.location.href,
): MistyAppRuntimeIdentity {
  const parameters = new URL(url).searchParams;
  const appId = parameters.get("mistyAppId")?.trim().toLowerCase() ?? "";
  const instanceId = parameters.get("mistyAppInstance")?.trim() ?? "";
  if (
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(appId) ||
    !/^misty-app-[a-f0-9-]{36}$/.test(instanceId)
  ) {
    throw new Error("This App does not have a valid Misty runtime identity.");
  }
  return { appId, instanceId };
}

export * from "./social.js";

export * from "./agents.js";

export type { AppInstallation, AppSession, SpaceAppInstallation, SpaceAppSession, PersonalSpaceTemplate } from "@misty/contracts";
