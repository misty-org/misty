import { memo } from "react";
import { ChromeTabStrip } from "./ChromeTabStrip";
import { MultiPanelWorkspaceView } from "./MultiPanelWorkspaceView";
import type { MultiPanelWorkspaceProps } from "./model/interfaces";
export { useMultiPanelStoreContext } from "./MultiPanelWorkspaceView";
export type { MultiPanelWorkspaceProps } from "./model/interfaces";

/** Host navigation labels and native browser coordination stay in the shell. */
export const MultiPanelWorkspace = memo(function MultiPanelWorkspace(
  props: MultiPanelWorkspaceProps,
) {
  return <MultiPanelWorkspaceView {...props} TabStrip={ChromeTabStrip} />;
});
