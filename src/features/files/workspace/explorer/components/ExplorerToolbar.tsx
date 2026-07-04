import { ExplorerDropTarget } from "../drag/ExplorerDropTarget";
import { ExplorerToolbarSearch } from "./ExplorerToolbarSearch";
import { ExplorerToolbarView } from "./ExplorerToolbarView";
import type { ExplorerToolbarProps } from "../model/interfaces/components/ExplorerToolbarModel";
export { ExplorerPaneToolbarActions } from "./ExplorerPaneToolbarActions";
export type {
  ExplorerCommandId,
  ExplorerLocationResult,
  ExplorerPaneToolbarActionsProps,
} from "./ExplorerToolbarModel";
const runtime = { DropTarget: ExplorerDropTarget, Search: ExplorerToolbarSearch };
export function ExplorerToolbar(props: ExplorerToolbarProps) {
  return <ExplorerToolbarView {...props} runtime={runtime} />;
}
