import { isAuthPath } from "@/app/shell/routes";
import { useSetupStore } from "../setup/useSetupStore";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { openSignInSheet, useSignInSheetStore } from "./signInSheetStore";

/**
 * The sidebar side is asked once, after the first-run wizard, when the workspace is on screen and
 * the sidebar can be seen moving. It waits for anything else the sheet is showing.
 */
export function useTabSidePrompt(): void {
  const pending = useSetupStore((state) => state.tabSidePending);
  const sheetOpen = useSignInSheetStore((state) => state.reason !== null);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!pending || sheetOpen || isAuthPath(pathname)) return;
    useSetupStore.getState().settleTabSide();
    openSignInSheet("tabs");
  }, [pending, sheetOpen, pathname]);
}
