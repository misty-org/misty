import { memo } from "react";
import { transferStyles } from "./transferStyles";
import { TransferWorkspacePane } from "./TransferWorkspacePane";

/** Transfers is now a single dock widget. Additional transfer views are
 * created as workspace tabs/panels instead of using a private pane grid. */
export const TransfersWorkspace = memo(function TransfersWorkspace() {
  return (
    <section className={transferStyles.workspace}>
      <TransferWorkspacePane workspaceId="transfers" />
    </section>
  );
});

export const TransfersWorkspacePanel = memo(function TransfersWorkspacePanel(props: {
  workspaceId: string;
}) {
  return <TransferWorkspacePane workspaceId={props.workspaceId} />;
});

export default TransfersWorkspace;
