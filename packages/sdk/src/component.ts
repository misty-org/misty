import type { MistyAppSDK } from "./index.js";

/** Host-supplied libraries; no application stores, documents or account services. */
export interface MistyComponentLibraries {
  readonly react: object;
  readonly reactDom: object;
  readonly reactDomClient: object;
  readonly jsxRuntime: object;
  readonly jsxDevRuntime: object;
  /** Optional Yjs 13 module. Collaborative components share constructors, never documents. */
  readonly yjs?: object;
}

export interface MistyComponentContext {
  /** Device availability hint only; native calls still require scoped authorization. */
  readonly devicePlatform?: "macos" | "windows" | "linux" | "android" | "ios";
  readonly instanceId: string;
  readonly route: string;
  readonly active: boolean;
  readonly focused?: boolean;
  readonly appearance: { readonly mode: "dark" | "light" };
}
export interface MistyComponentMount {
  update(context: MistyComponentContext): void;
  unmount(): void | Promise<void>;
}
/** Optional app-owned state shared by views in one host-scoped app session.
 * Each mount still receives its own SDK and abort signal; never retain a view's
 * SDK as authority for another view. The host closes this session on account
 * reset, or after its last view's bounded idle grace period. */
export interface MistyComponentSession {
  mount: MistyComponentDefinition["mount"];
  close(): void | Promise<void>;
}
export interface MistyComponentDefinition {
  readonly appId: string;
  readonly protocol: 2;
  createSession?(input: {
    readonly signal: AbortSignal;
    readonly libraries?: MistyComponentLibraries;
  }): MistyComponentSession | Promise<MistyComponentSession>;
  mount(input: {
    readonly root: HTMLElement;
    readonly signal?: AbortSignal;
    readonly libraries?: MistyComponentLibraries;
    readonly misty: MistyAppSDK;
    readonly context: MistyComponentContext;
  }): MistyComponentMount | Promise<MistyComponentMount>;
}

/** Export this value as the package's default ES-module export. No iframe or global Host is required. */
export function defineComponentApp(
  definition: MistyComponentDefinition,
): MistyComponentDefinition {
  if (
    definition.protocol !== 2 ||
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(definition.appId) ||
    typeof definition.mount !== "function" ||
    (definition.createSession !== undefined && typeof definition.createSession !== "function")
  )
    throw new Error("Invalid Misty component App definition.");
  return Object.freeze({ ...definition });
}
