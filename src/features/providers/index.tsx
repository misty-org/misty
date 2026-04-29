import { lazy, Suspense } from "react";

const LazyProvidersWorkspace = lazy(async () => ({
  default: (await import("./ProvidersPage")).ProvidersWorkspace,
}));
const LazyProvidersWorkspacePanel = lazy(async () => ({
  default: (await import("./ProvidersPage")).ProvidersWorkspacePanel,
}));

export function ProvidersWorkspace(props: {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <LazyProvidersWorkspace {...props} />
    </Suspense>
  );
}

export function ProvidersWorkspacePanel(props: { workspaceId: string }) {
  return (
    <Suspense fallback={null}>
      <LazyProvidersWorkspacePanel {...props} />
    </Suspense>
  );
}

export const ProvidersPage = ProvidersWorkspace;
export default ProvidersWorkspace;
export * from "./providerUtils";
export * from "./store";
