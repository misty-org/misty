import { isAuthPath } from "@/app/shell/routes";
import { useSetupStore } from "../setup/use_setup_store";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { openSignInSheet, useSignInSheetStore } from "./sign_in_sheet_store";

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
