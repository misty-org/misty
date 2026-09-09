/** Build-time bindings to shared SDK-only Browser UI and preserved legacy app packages. */
declare module "@misty/browser-view" {
  import type { ReactNode } from "react";
  import type {
    MistyAppSDK,
    MistyComponentContext,
    MistyBrowserProvider,
    MistyAppCommand,
  } from "@misty/sdk";
  export function SDKBrowserView(props: {
    services: {
      misty: MistyAppSDK;
      report(error: unknown): void;
      register(
        command: MistyAppCommand,
        action: () => void,
        enabled: () => boolean,
      ): () => void;
    };
    context: MistyComponentContext;
    provider?: MistyBrowserProvider;
    initialUrl?: string;
    toolbar?: ReactNode;
    onView?: (
      view: Awaited<ReturnType<MistyAppSDK["browser"]["create"]>> | null,
    ) => void;
  }): ReactNode;
}
declare module "@misty/legacy-social" {
  const app: import("@misty/sdk").MistyComponentDefinition;
  export default app;
}
declare module "@misty/legacy-inbox" {
  const app: import("@misty/sdk").MistyComponentDefinition;
  export default app;
}
