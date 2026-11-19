import { createContext, useContext } from "react";
import type { WorkspaceView } from "@/features/app-windows";

/** How a bar item opens a page: the canvas's own `openTab`, so it focuses and routes as a tab does. */
export const BottomBarOpenContext = createContext<(view: WorkspaceView) => void>(() => {});

/** The bar's way to open a page, from the canvas around it. */
export const useBottomBarOpen = () => useContext(BottomBarOpenContext);
