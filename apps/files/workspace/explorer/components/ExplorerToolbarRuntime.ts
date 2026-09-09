import type { ComponentProps, ComponentType } from "react";
import type { ExplorerDropTarget } from "../drag/ExplorerDropTarget";
import type { ExplorerToolbarSearchProps } from "./ExplorerToolbarSearch";
/** The same toolbar uses the owning host or downloaded Files app's services. */
export interface ExplorerToolbarRuntime {
  DropTarget: ComponentType<ComponentProps<typeof ExplorerDropTarget>>;
  Search: ComponentType<ExplorerToolbarSearchProps>;
}
