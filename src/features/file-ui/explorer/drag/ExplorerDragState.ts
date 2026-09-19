import { createContext } from "react";
import type { ExplorerDragContextValue } from "./ExplorerDragTypes";
export const ExplorerDragContext = createContext<ExplorerDragContextValue | null>(null);
