import { lazy, Suspense } from "react";

export * from "./store";
export * from "./transferModel";
export * from "./transferStyles";
export * from "./transferUtils";

const LazyTransfersWorkspace = lazy(async () => ({
  default: (await import("./TransfersPage")).TransfersWorkspace,
}));
const LazyTransfersWorkspacePanel = lazy(async () => ({
  default: (await import("./TransfersPage")).TransfersWorkspacePanel,
}));

export function TransfersPage() {
  return (
    <Suspense fallback={null}>
      <LazyTransfersWorkspace />
    </Suspense>
  );
}

export function TransfersWorkspacePanel(props: { workspaceId: string }) {
  return (
    <Suspense fallback={null}>
      <LazyTransfersWorkspacePanel {...props} />
    </Suspense>
  );
}

export default TransfersPage;
