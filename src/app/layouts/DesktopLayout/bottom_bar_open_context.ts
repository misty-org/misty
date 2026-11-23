import { createContext, useContext } from "react";
import type { WorkspaceView } from "@/features/app-windows";

export const BottomBarOpenContext = createContext<(view: WorkspaceView) => void>(() => {});

export const useBottomBarOpen = () => useContext(BottomBarOpenContext);
