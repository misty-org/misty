import { createMultiPanelStore, MultiPanelWorkspace } from "@/features/workspace";
import { memo, useEffect } from "react";
import {
  loadTransfersMultiPanelSnapshot,
  saveTransfersMultiPanelSnapshot,
} from "./transferPersistence";
import { transferStyles } from "./transferStyles";
import { TransferWorkspacePane } from "./TransferWorkspacePane";

const useTransfersMultiPanelStore = createMultiPanelStore({
  idPrefix: "transfers",
  defaultTitle: "Transfers",
});

export const TransfersWorkspace = memo(function TransfersWorkspace() {
  useEffect(() => {
    const state = useTransfersMultiPanelStore.getState();
    if (state.tabs.length === 0) {
      const snapshot = loadTransfersMultiPanelSnapshot();
      if (!snapshot || !state.hydrate(snapshot))
        state.initialize("transfers://history", "Transfers");
    }
    saveTransfersMultiPanelSnapshot(useTransfersMultiPanelStore.getState());
    return useTransfersMultiPanelStore.subscribe(saveTransfersMultiPanelSnapshot);
  }, []);

  return (
    <MultiPanelWorkspace
      className={transferStyles.workspace}
      store={useTransfersMultiPanelStore}
      renderPane={(paneId) => <TransferWorkspacePane workspaceId={paneId} />}
    />
  );
});

export const TransfersWorkspacePanel = memo(function TransfersWorkspacePanel(props: {
  workspaceId: string;
}) {
  return <TransferWorkspacePane workspaceId={props.workspaceId} />;
});

export default TransfersWorkspace;
